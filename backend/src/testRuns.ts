import crypto from "node:crypto";
import {
  compilePlanToElementTests,
  findCaseInPlan,
  getPlan,
  listAllCases,
  type TestCase,
} from "./plans.ts";
import { getProcess, upsertProcess } from "./processes.ts";
import {
  createRun,
  markRunFinished,
  upsertResult,
  type RunRecord,
  type TaskResult,
} from "./store.ts";
import type { TestDef } from "./tags.ts";
import { substituteTestDef } from "./substitute.ts";
import { runHttpTest } from "./workers/http-worker.ts";
import { runBrowserTest } from "./workers/browser-worker.ts";
import { runScriptTest } from "./workers/script-worker.ts";

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

export interface PlannedExecution {
  nodeId: string;
  suiteId: string;
  scenarioId: string;
  testCase: TestCase;
  dataSetId?: string;
  rowIndex?: number;
  variables: Record<string, unknown>;
}

export interface StartTestRunInput {
  scope: TestRunScope;
  environment?: string;
}

export interface StartTestRunResult {
  runId: string;
  processInstanceId: string;
  planned: number;
}

async function dispatchTest(
  def: TestDef,
  ctx: {
    runId: string;
    activityId: string;
    processKey: string;
    variables: Record<string, unknown>;
  },
): Promise<{
  passed: boolean;
  message: string;
  evidence: Record<string, unknown>;
  variables: Record<string, unknown>;
}> {
  const substituted = substituteTestDef(def, ctx.variables);
  if (substituted.type === "http.api") {
    const result = await runHttpTest(substituted);
    const variables: Record<string, unknown> = {};
    if (substituted.setVariables && result.passed) {
      for (const [k, pathExpr] of Object.entries(substituted.setVariables)) {
        try {
          const { JSONPath } = await import("jsonpath-plus");
          const json = JSON.parse(result.bodyPreview || "{}");
          variables[k] = JSONPath({ path: pathExpr, json })?.[0];
        } catch {}
      }
    }
    return {
      passed: result.passed,
      message: result.reasons.join("; ") || "ok",
      evidence: {
        type: "http",
        request: substituted.request,
        response: { status: result.status, bodyPreview: result.bodyPreview },
        durationMs: result.durationMs,
      },
      variables,
    };
  }
  if (substituted.type === "browser.playwright") {
    const result = await runBrowserTest(substituted, {
      runId: ctx.runId,
      activityId: ctx.activityId,
    });
    const variables: Record<string, unknown> = {};
    if (substituted.setVariables && result.passed) {
      for (const [k, expr] of Object.entries(substituted.setVariables)) {
        if (expr === "expect.passed") variables[k] = result.passed;
      }
    }
    return {
      passed: result.passed,
      message: result.reasons.join("; ") || "ok",
      evidence: { type: "browser", steps: result.steps, durationMs: result.durationMs },
      variables,
    };
  }
  if (substituted.type === "script.python") {
    const result = await runScriptTest(substituted, {
      runId: ctx.runId,
      activityId: ctx.activityId,
      processKey: ctx.processKey,
      variables: ctx.variables,
    });
    const variables: Record<string, unknown> = {};
    if (result.parsedResult?.setVariables) {
      for (const [k, v] of Object.entries(result.parsedResult.setVariables)) {
        if (!k.startsWith("__")) variables[k] = v;
      }
    }
    return {
      passed: result.passed,
      message: result.reasons.join("; ") || "ok",
      evidence: {
        type: "script",
        language: "python",
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        logUrl: result.logUrl,
        parsedResult: result.parsedResult,
      },
      variables,
    };
  }
  throw new Error(`unknown test type`);
}

export function expandScope(
  scope: TestRunScope,
  plan: Awaited<ReturnType<typeof getPlan>>,
  environment = "default",
): PlannedExecution[] {
  const out: PlannedExecution[] = [];
  const pushCase = (
    nodeId: string,
    suiteId: string,
    scenarioId: string,
    testCase: TestCase,
  ) => {
    if (!testCase.executable) return;
    const dataSets =
      testCase.dataSets.length > 0
        ? testCase.dataSets
        : [{ id: "_default", name: "Default", rows: [{}] }];
    for (const ds of dataSets) {
      const rows = ds.rows.length > 0 ? ds.rows : [{}];
      rows.forEach((row, rowIndex) => {
        out.push({
          nodeId,
          suiteId,
          scenarioId,
          testCase,
          dataSetId: ds.id,
          rowIndex,
          variables: { ...(testCase.variables ?? {}), ...row, environment },
        });
      });
    }
  };

  if (scope.type === "case" && scope.caseId) {
    const found = findCaseInPlan(plan, scope.caseId);
    if (!found) return out;
    pushCase(found.node.nodeId, found.suite.id, found.scenario.id, found.testCase);
    return out;
  }

  for (const entry of listAllCases(plan)) {
    if (scope.nodeId && entry.nodeId !== scope.nodeId) continue;
    if (scope.suiteId && entry.suiteId !== scope.suiteId) continue;
    if (scope.scenarioId && entry.scenarioId !== scope.scenarioId) continue;
    if (scope.type === "node" && !scope.nodeId) continue;
    pushCase(entry.nodeId, entry.suiteId, entry.scenarioId, entry.testCase);
  }
  return out;
}

export async function startTestRun(
  input: StartTestRunInput,
): Promise<StartTestRunResult> {
  const proc = await getProcess(input.scope.processKey);
  if (!proc) throw new Error(`process not found: ${input.scope.processKey}`);

  const plan = await getPlan(input.scope.processKey);
  const planned = expandScope(input.scope, plan, input.environment);
  if (planned.length === 0) {
    throw new Error("no executable test cases found for scope");
  }

  const runId = crypto.randomUUID();
  const processInstanceId = crypto.randomUUID();
  const record: RunRecord = {
    runId,
    processInstanceId,
    processKey: input.scope.processKey,
    kind: "plan",
    environment: input.environment,
    scope: JSON.stringify(input.scope),
    startedAt: new Date().toISOString(),
    results: {},
  };
  await createRun(record);

  void (async () => {
    for (const item of planned) {
      if (!item.testCase.executable) continue;
      const activityId = `${item.testCase.id}_r${item.rowIndex ?? 0}`;
      const startedAt = new Date().toISOString();
      await upsertResult(processInstanceId, {
        activityId,
        status: "running",
        startedAt,
        traceability: {
          nodeId: item.nodeId,
          suiteId: item.suiteId,
          scenarioId: item.scenarioId,
          caseId: item.testCase.id,
          caseName: item.testCase.name,
          dataSetId: item.dataSetId,
          rowIndex: item.rowIndex,
        },
      });
      try {
        const result = await dispatchTest(item.testCase.executable, {
          runId,
          activityId,
          processKey: input.scope.processKey,
          variables: item.variables,
        });
        const finished: TaskResult = {
          activityId,
          status: result.passed ? "passed" : "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: result.message,
          evidence: result.evidence,
          traceability: {
            nodeId: item.nodeId,
            suiteId: item.suiteId,
            scenarioId: item.scenarioId,
            caseId: item.testCase.id,
            caseName: item.testCase.name,
            dataSetId: item.dataSetId,
            rowIndex: item.rowIndex,
          },
        };
        await upsertResult(processInstanceId, finished);
      } catch (err) {
        await upsertResult(processInstanceId, {
          activityId,
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: (err as Error).message,
          traceability: {
            nodeId: item.nodeId,
            suiteId: item.suiteId,
            scenarioId: item.scenarioId,
            caseId: item.testCase.id,
            caseName: item.testCase.name,
            dataSetId: item.dataSetId,
            rowIndex: item.rowIndex,
          },
        });
      }
    }
    await markRunFinished(processInstanceId);
  })();

  return { runId, processInstanceId, planned: planned.length };
}

export async function syncPlanToTags(processKey: string) {
  const plan = await getPlan(processKey);
  const proc = await getProcess(processKey);
  if (!proc) throw new Error("process not found");
  const elementTests = compilePlanToElementTests(plan);
  await upsertProcess({
    key: processKey,
    bpmnXml: proc.bpmnXml,
    tags: { processKey, elementTests },
  });
}
