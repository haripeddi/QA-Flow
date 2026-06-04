export type TestType = "http.api" | "browser.playwright" | "script.python";

export interface HttpRequestDef {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface HttpExpectation {
  status?: number;
  jsonPath?: Record<string, unknown>;
}
export interface HttpTestDef {
  name: string;
  type: "http.api";
  request: HttpRequestDef;
  expect: HttpExpectation;
  setVariables?: Record<string, string>;
}

export type BrowserAction =
  | "goto"
  | "click"
  | "tryClick"
  | "fill"
  | "press"
  | "waitForSelector"
  | "waitForTimeout"
  | "waitForLoadState"
  | "screenshot"
  | "assertContains"
  | "assertVisible";

export interface BrowserStep {
  action: BrowserAction;
  selector?: string;
  url?: string;
  value?: string;
  state?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  name?: string;
  text?: string;
  ignoreCase?: boolean;
  optional?: boolean;
}

export interface BrowserTestDef {
  name: string;
  type: "browser.playwright";
  steps: BrowserStep[];
  setVariables?: Record<string, string>;
}

export interface ScriptTestDef {
  name: string;
  type: "script.python";
  code: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export type TestDef = HttpTestDef | BrowserTestDef | ScriptTestDef;

export interface TagsFile {
  processKey: string;
  elementTests: Record<string, TestDef>;
}

export interface ProcessSummary {
  key: string;
  name: string;
  description: string;
  updatedAt: string;
}

export interface ProcessFullDef {
  key: string;
  name: string;
  description: string;
  bpmnXml: string;
  tags: TagsFile;
  updatedAt: string;
}

export interface BrowserStepResult {
  index: number;
  action: string;
  name?: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
  screenshotUrl?: string;
  durationMs: number;
}

export interface BrowserEvidence {
  type: "browser";
  steps: BrowserStepResult[];
  durationMs: number;
}

export interface ScriptEvidence {
  type: "script";
  language: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  logUrl?: string;
  parsedResult?: {
    message?: string;
    setVariables?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
  };
}

export interface HttpEvidence {
  type?: "http";
  request?: { method: string; url: string; body?: unknown };
  response?: { status: number; bodyPreview: string };
  durationMs?: number;
}

export interface TraceabilityRef {
  nodeId?: string;
  suiteId?: string;
  scenarioId?: string;
  caseId?: string;
  caseName?: string;
  dataSetId?: string;
  rowIndex?: number;
}

export interface ActivityState {
  activityId: string;
  activityName: string | null;
  activityType: string;
  startTime: string;
  endTime: string | null;
  durationInMillis: number | null;
  status: "pending" | "running" | "passed" | "failed" | "executed";
  message?: string;
  traceability?: TraceabilityRef;
  evidence?:
    | BrowserEvidence
    | HttpEvidence
    | ScriptEvidence
    | Record<string, unknown>;
}

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

export interface PlanTestCase {
  id: string;
  name: string;
  description?: string;
  variables?: Record<string, unknown>;
  executable?: TestDef;
  steps: TestStep[];
  dataSets: TestDataSet[];
  tags?: string[];
}

export interface PlanScenario {
  id: string;
  name: string;
  description?: string;
  cases: PlanTestCase[];
}

export interface PlanTestSuite {
  id: string;
  name: string;
  description?: string;
  scenarios: PlanScenario[];
}

export interface NodePlan {
  nodeId: string;
  nodeName?: string;
  suites: PlanTestSuite[];
  primaryCaseId?: string;
}

export interface TestPlanFile {
  processKey: string;
  version: 1;
  nodes: Record<string, NodePlan>;
  updatedAt: string;
}

export type TestRunScopeType =
  | "case"
  | "scenario"
  | "suite"
  | "workflow"
  | "node";

export interface TestRunScope {
  type: TestRunScopeType;
  processKey: string;
  nodeId?: string;
  suiteId?: string;
  scenarioId?: string;
  caseId?: string;
}

export type TraceabilityView =
  | "workflow_to_suite"
  | "workflow_to_scenario"
  | "workflow_to_case"
  | "case_to_workflow"
  | "case_to_results";

export interface RunState {
  run: {
    runId: string;
    processInstanceId: string;
    processKey: string;
    kind?: "workflow" | "plan";
    environment?: string;
    scope?: string;
    startedAt: string;
    finishedAt?: string;
    results: Record<string, ActivityState>;
  } | null;
  active: boolean;
  activities: ActivityState[];
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${clean}`;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = `${res.status}: ${body.error}`;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await apiFetch("/api/health");
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchProcesses(): Promise<ProcessSummary[]> {
  const data = await jsonOrThrow<{ processes: ProcessSummary[] }>(
    await apiFetch("/api/processes"),
  );
  return data.processes;
}

export async function fetchProcess(key: string): Promise<ProcessFullDef> {
  return jsonOrThrow(await apiFetch(`/api/processes/${encodeURIComponent(key)}`));
}

export async function createProcess(input: {
  key: string;
  name?: string;
  sourceKey?: string;
}): Promise<ProcessFullDef> {
  return jsonOrThrow(
    await apiFetch("/api/processes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function saveProcess(
  key: string,
  payload: { bpmnXml: string; tags: TagsFile },
): Promise<ProcessFullDef> {
  return jsonOrThrow(
    await apiFetch(`/api/processes/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function deleteProcess(key: string): Promise<void> {
  await jsonOrThrow(
    await apiFetch(`/api/processes/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }),
  );
}

export async function startRun(
  processKey: string,
  options?: { environment?: string; tag?: string },
): Promise<{ runId: string }> {
  return jsonOrThrow(
    await apiFetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        processKey,
        environment: options?.environment,
        tag: options?.tag,
      }),
    }),
  );
}

export interface UseCaseSummary {
  key: string;
  name: string;
  description?: string;
  updatedAt?: string;
  nodeCount: number;
  testCaseCount: number;
  automatedCount: number;
  manualCount: number;
  passed: number;
  failed: number;
  notRun: number;
  runCount: number;
  lastRunAt?: string;
}

export async function fetchUseCases(): Promise<UseCaseSummary[]> {
  const data = await jsonOrThrow<{ useCases: UseCaseSummary[] }>(
    await apiFetch("/api/usecases"),
  );
  return data.useCases;
}

export async function fetchRun(runId: string): Promise<RunState> {
  return jsonOrThrow(await apiFetch(`/api/runs/${runId}`));
}

export async function listRuns(): Promise<RunState["run"][]> {
  const res = await jsonOrThrow<{ runs: RunState["run"][] }>(
    await apiFetch("/api/runs"),
  );
  return res.runs ?? [];
}

export async function fetchPlan(processKey: string): Promise<TestPlanFile> {
  const res = await jsonOrThrow<{ plan: TestPlanFile }>(
    await apiFetch(`/api/processes/${processKey}/plan`),
  );
  return res.plan;
}

export async function savePlan(
  processKey: string,
  plan: TestPlanFile,
): Promise<TestPlanFile> {
  const res = await jsonOrThrow<{ plan: TestPlanFile }>(
    await apiFetch(`/api/processes/${processKey}/plan`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    }),
  );
  return res.plan;
}

export async function exportPlan(processKey: string) {
  return jsonOrThrow(await apiFetch(`/api/processes/${processKey}/plan/export`));
}

export async function importPlan(processKey: string, plan: TestPlanFile) {
  return jsonOrThrow<{ plan: TestPlanFile }>(
    await apiFetch(`/api/processes/${processKey}/plan/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    }),
  );
}

export async function startTestRun(input: {
  scope: TestRunScope;
  environment?: string;
}): Promise<{ runId: string; processInstanceId: string; planned: number }> {
  return jsonOrThrow(
    await apiFetch("/api/test-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function generateDataSet(
  processKey: string,
  nodeId: string,
  caseId: string,
  dataSetId: string,
  count = 5,
): Promise<Record<string, unknown>[]> {
  const res = await jsonOrThrow<{ rows: Record<string, unknown>[] }>(
    await apiFetch(
      `/api/processes/${processKey}/plan/nodes/${nodeId}/cases/${caseId}/datasets/${dataSetId}/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      },
    ),
  );
  return res.rows;
}

export interface TraceabilityInsights {
  workflowsCreated: number;
  workflowsExecuted: number;
  suitesCreated: number;
  scenariosCreated: number;
  casesCreated: number;
  casesExecuted: number;
  passed: number;
  failed: number;
  executed: number;
  coverageGaps: Array<{ processKey: string; nodeId: string; reason: string }>;
  failedCases: Array<{
    processKey: string;
    caseId?: string;
    caseName?: string;
    nodeId?: string;
    message?: string;
  }>;
  trends: Array<{ date: string; passed: number; failed: number }>;
}

export interface TraceabilityRow {
  workflowKey: string;
  workflowName: string;
  nodeId?: string;
  suiteId?: string;
  suiteName?: string;
  scenarioId?: string;
  scenarioName?: string;
  caseId?: string;
  caseName?: string;
  lastStatus?: string;
  lastRunAt?: string;
}

export interface TraceabilityResponse {
  view: TraceabilityView;
  rows: TraceabilityRow[];
  insights: TraceabilityInsights;
}

export async function fetchTraceability(view: TraceabilityView) {
  return jsonOrThrow<TraceabilityResponse>(
    await apiFetch(`/api/traceability?view=${encodeURIComponent(view)}`),
  );
}

export async function aiGenerateWorkflow(processKey: string, prompt: string) {
  return jsonOrThrow<{ bpmnXml: string; explanation: string }>(
    await apiFetch("/api/ai/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ processKey, prompt }),
    }),
  );
}

export async function aiModifyWorkflow(
  processKey: string,
  bpmnXml: string,
  instruction: string,
) {
  return jsonOrThrow<{ bpmnXml: string; explanation: string }>(
    await apiFetch("/api/ai/workflow/modify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ processKey, bpmnXml, instruction }),
    }),
  );
}

export async function aiRecommendAssets(body: {
  processKey: string;
  nodeId: string;
  nodeName?: string;
  bpmnXml: string;
  planSummary?: string;
}) {
  return jsonOrThrow<{
    suites: Array<{
      name: string;
      scenarios: Array<{
        name: string;
        cases: Array<{
          name: string;
          steps: Array<{ name: string; action: string; expectedResult?: string }>;
        }>;
      }>;
    }>;
    raw: string;
  }>(
    await apiFetch("/api/ai/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export function newPlanId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function resolveAssetUrl(path: string | undefined): string | undefined {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return apiUrl(path);
}

export function isBrowserEvidence(
  e: ActivityState["evidence"],
): e is BrowserEvidence {
  return !!e && typeof e === "object" && (e as { type?: string }).type === "browser";
}

export function isScriptEvidence(
  e: ActivityState["evidence"],
): e is ScriptEvidence {
  return !!e && typeof e === "object" && (e as { type?: string }).type === "script";
}

export const PYTHON_TEMPLATE = `# QA Flow Python step
# Environment:
#   QA_PROCESS_KEY, QA_ACTIVITY_ID, QA_RUN_ID
#   QA_VARS  -> JSON object of engine variables you can read
# Result protocol:
#   Exit code 0 = pass, anything else = fail.
#   To set engine variables / message / evidence, print a line starting with
#   "##QA_RESULT##" followed by a JSON object, e.g.:
#       print('##QA_RESULT##', json.dumps({"message":"ok","setVariables":{"x": 1}}))

import json, os, sys

vars_in = json.loads(os.environ.get("QA_VARS", "{}"))
print("activity:", os.environ.get("QA_ACTIVITY_ID"))
print("inputs:", vars_in)

# Your assertions:
assert 1 + 1 == 2, "math broke"

print('##QA_RESULT##', json.dumps({"message": "ok"}))
`;

export function defaultTestFor(
  type: TestType,
  elementName: string,
): TestDef {
  if (type === "http.api") {
    return {
      name: elementName || "HTTP test",
      type: "http.api",
      request: { method: "GET", url: "" },
      expect: { status: 200 },
    };
  }
  if (type === "script.python") {
    return {
      name: elementName || "Python test",
      type: "script.python",
      code: PYTHON_TEMPLATE,
      timeoutMs: 30000,
    };
  }
  return {
    name: elementName || "Browser test",
    type: "browser.playwright",
    steps: [{ action: "goto", url: "" }],
  };
}
