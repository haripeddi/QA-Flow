import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PLANS_DIR, planPathFor } from "./config.ts";
import { validateKey } from "./processes.ts";
import type { TagsFile, TestDef } from "./tags.ts";
import { loadTags } from "./tags.ts";

export interface TestStep {
  id: string;
  name: string;
  action: string;
  params?: Record<string, unknown>;
  expectedResult?: string;
  reusableStepId?: string;
}

export interface TestDataSet {
  id: string;
  name: string;
  rows: Record<string, unknown>[];
  fakerSchema?: Record<string, string>;
}

export interface TestCase {
  id: string;
  name: string;
  description?: string;
  executable?: TestDef;
  steps: TestStep[];
  dataSets: TestDataSet[];
  tags?: string[];
}

export interface Scenario {
  id: string;
  name: string;
  description?: string;
  cases: TestCase[];
}

export interface TestSuite {
  id: string;
  name: string;
  description?: string;
  scenarios: Scenario[];
}

export interface NodePlan {
  nodeId: string;
  nodeName?: string;
  suites: TestSuite[];
  /** When set, this executable is compiled to elementTests for BPMN runs */
  primaryCaseId?: string;
}

export interface TestPlanFile {
  processKey: string;
  version: 1;
  nodes: Record<string, NodePlan>;
  updatedAt: string;
}

const planCache = new Map<string, TestPlanFile>();

export async function ensurePlansDir() {
  await fs.mkdir(PLANS_DIR, { recursive: true });
}

async function atomicWrite(file: string, contents: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, file);
}

function newId(): string {
  return randomUUID().slice(0, 8);
}

export function emptyPlan(processKey: string): TestPlanFile {
  return {
    processKey,
    version: 1,
    nodes: {},
    updatedAt: new Date().toISOString(),
  };
}

function wrapLegacyTest(nodeId: string, test: TestDef): NodePlan {
  const caseId = newId();
  return {
    nodeId,
    suites: [
      {
        id: newId(),
        name: "Default Suite",
        scenarios: [
          {
            id: newId(),
            name: "Default Scenario",
            cases: [
              {
                id: caseId,
                name: test.name || "Migrated test",
                executable: test,
                steps: [],
                dataSets: [],
              },
            ],
          },
        ],
      },
    ],
    primaryCaseId: caseId,
  };
}

export async function migratePlanFromTags(
  processKey: string,
  elementTests: Record<string, TestDef>,
): Promise<TestPlanFile> {
  const plan = emptyPlan(processKey);
  for (const [nodeId, test] of Object.entries(elementTests)) {
    if (!test) continue;
    plan.nodes[nodeId] = wrapLegacyTest(nodeId, test);
  }
  plan.updatedAt = new Date().toISOString();
  return plan;
}

export async function getPlan(processKey: string): Promise<TestPlanFile> {
  const cached = planCache.get(processKey);
  if (cached) return cached;

  await ensurePlansDir();
  try {
    const raw = await fs.readFile(planPathFor(processKey), "utf8");
    const parsed = JSON.parse(raw) as TestPlanFile;
    if (!parsed.nodes) parsed.nodes = {};
    planCache.set(processKey, parsed);
    return parsed;
  } catch {
    const tags = await loadTags(processKey);
    const migrated = await migratePlanFromTags(
      processKey,
      tags.elementTests ?? {},
    );
    await upsertPlan(migrated);
    return migrated;
  }
}

export async function upsertPlan(plan: TestPlanFile): Promise<TestPlanFile> {
  validateKey(plan.processKey);
  await ensurePlansDir();
  const normalized: TestPlanFile = {
    processKey: plan.processKey,
    version: 1,
    nodes: plan.nodes ?? {},
    updatedAt: new Date().toISOString(),
  };
  await atomicWrite(
    planPathFor(plan.processKey),
    JSON.stringify(normalized, null, 2),
  );
  planCache.set(plan.processKey, normalized);
  return normalized;
}

export function clearPlanCache(key?: string) {
  if (key) planCache.delete(key);
  else planCache.clear();
}

export async function deletePlan(processKey: string) {
  await fs.rm(planPathFor(processKey), { force: true });
  clearPlanCache(processKey);
}

/** Mirror primary (or first) case executable per node into elementTests */
export function compilePlanToElementTests(
  plan: TestPlanFile,
): TagsFile["elementTests"] {
  const out: TagsFile["elementTests"] = {};
  for (const node of Object.values(plan.nodes)) {
    let chosen: TestCase | undefined;
    for (const suite of node.suites) {
      for (const scenario of suite.scenarios) {
        for (const c of scenario.cases) {
          if (node.primaryCaseId && c.id === node.primaryCaseId) {
            chosen = c;
            break;
          }
          if (!chosen && c.executable) chosen = c;
        }
        if (chosen?.id === node.primaryCaseId) break;
      }
      if (chosen?.id === node.primaryCaseId) break;
    }
    if (chosen?.executable) {
      out[node.nodeId] = chosen.executable;
    }
  }
  return out;
}

export function getNodePlan(plan: TestPlanFile, nodeId: string): NodePlan {
  if (!plan.nodes[nodeId]) {
    plan.nodes[nodeId] = { nodeId, suites: [] };
  }
  return plan.nodes[nodeId];
}

export interface BulkCaseInput {
  name: string;
  description?: string;
  executable?: TestDef;
  steps?: TestStep[];
  dataSets?: TestDataSet[];
}

export async function bulkUpsertCases(
  processKey: string,
  nodeId: string,
  suiteId: string,
  scenarioId: string,
  cases: BulkCaseInput[],
): Promise<TestPlanFile> {
  const plan = await getPlan(processKey);
  const node = getNodePlan(plan, nodeId);
  const suite = node.suites.find((s) => s.id === suiteId);
  if (!suite) throw new Error(`suite not found: ${suiteId}`);
  const scenario = suite.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`scenario not found: ${scenarioId}`);

  for (const input of cases) {
    const existing = scenario.cases.find((c) => c.name === input.name);
    if (existing) {
      existing.description = input.description ?? existing.description;
      if (input.executable) existing.executable = input.executable;
      if (input.steps) existing.steps = input.steps;
      if (input.dataSets) existing.dataSets = input.dataSets;
    } else {
      const id = newId();
      scenario.cases.push({
        id,
        name: input.name,
        description: input.description,
        executable: input.executable,
        steps: input.steps ?? [],
        dataSets: input.dataSets ?? [],
      });
      if (!node.primaryCaseId && input.executable) {
        node.primaryCaseId = id;
      }
    }
  }
  return upsertPlan(plan);
}

export function findCaseInPlan(
  plan: TestPlanFile,
  caseId: string,
): {
  node: NodePlan;
  suite: TestSuite;
  scenario: Scenario;
  testCase: TestCase;
} | null {
  for (const node of Object.values(plan.nodes)) {
    for (const suite of node.suites) {
      for (const scenario of suite.scenarios) {
        const testCase = scenario.cases.find((c) => c.id === caseId);
        if (testCase) return { node, suite, scenario, testCase };
      }
    }
  }
  return null;
}

export function findDataSetInPlan(
  plan: TestPlanFile,
  dataSetId: string,
): { testCase: TestCase; dataSet: TestDataSet } | null {
  for (const node of Object.values(plan.nodes)) {
    for (const suite of node.suites) {
      for (const scenario of suite.scenarios) {
        for (const testCase of scenario.cases) {
          const dataSet = testCase.dataSets.find((d) => d.id === dataSetId);
          if (dataSet) return { testCase, dataSet };
        }
      }
    }
  }
  return null;
}

export function listAllCases(plan: TestPlanFile): Array<{
  nodeId: string;
  suiteId: string;
  scenarioId: string;
  testCase: TestCase;
}> {
  const out: Array<{
    nodeId: string;
    suiteId: string;
    scenarioId: string;
    testCase: TestCase;
  }> = [];
  for (const node of Object.values(plan.nodes)) {
    for (const suite of node.suites) {
      for (const scenario of suite.scenarios) {
        for (const testCase of scenario.cases) {
          out.push({
            nodeId: node.nodeId,
            suiteId: suite.id,
            scenarioId: scenario.id,
            testCase,
          });
        }
      }
    }
  }
  return out;
}
