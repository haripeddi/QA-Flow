import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { Engine } from "bpmn-engine";
import * as Elements from "bpmn-elements";
import { getProcess } from "./processes.ts";
import { loadTags, type TestDef } from "./tags.ts";
import {
  createRun,
  markRunFinished,
  upsertResult,
  type RunRecord,
} from "./store.ts";
import { runHttpTest } from "./workers/http-worker.ts";
import { runBrowserTest } from "./workers/browser-worker.ts";
import { runScriptTest } from "./workers/script-worker.ts";

export interface StartResult {
  runId: string;
  processInstanceId: string;
  processKey: string;
}

interface ActiveRun {
  runId: string;
  processInstanceId: string;
  processKey: string;
  startedAt: string;
  finishedAt?: string;
  visited: string[];
}

const activeRuns = new Map<string, ActiveRun>();
const runUserVariables = new Map<string, Record<string, unknown>>();

const ActivityCtor = (Elements as unknown as { Activity: unknown }).Activity as new (
  Behaviour: unknown,
  activityDef: unknown,
  context: unknown,
) => unknown;

function QaServiceTask(this: unknown, activityDef: unknown, context: unknown) {
  return new ActivityCtor(QaServiceTaskBehaviour, activityDef, context);
}

function QaServiceTaskBehaviour(this: any, activity: any) {
  this.id = activity.id;
  this.type = activity.type;
  this.activity = activity;
  this.environment = activity.environment;
  this.broker = activity.broker;
}

QaServiceTaskBehaviour.prototype.execute = function execute(
  executeMessage: { content: { id: string; executionId: string } },
) {
  const broker = this.broker;
  const content = executeMessage.content;
  const activityId = content.id;
  const environment = this.environment;
  const processInstanceId = environment.variables?.__processInstanceId as
    | string
    | undefined;
  const processKey = environment.variables?.__processKey as string | undefined;
  const runId = environment.variables?.__runId as string | undefined;

  const startedAt = new Date().toISOString();
  if (processInstanceId) {
    void upsertResult(processInstanceId, {
      activityId,
      status: "running",
      startedAt,
    });
  }

  const finish = (variables: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(variables)) {
      environment.variables[k] = v;
    }
    broker.publish("execution", "execute.completed", {
      ...content,
      output: variables,
      state: "complete",
    });
  };

  const fail = (errorMessage: string) => {
    broker.publish(
      "execution",
      "execute.error",
      { ...content, error: new Error(errorMessage) },
      { mandatory: true },
    );
  };

  (async () => {
    if (!processKey || !processInstanceId || !runId) {
      finish({});
      return;
    }
    try {
      const tags = await loadTags(processKey);
      const def = tags.elementTests[activityId];
      if (!def) {
        await upsertResult(processInstanceId, {
          activityId,
          status: "executed",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: "no test tagged; passing through",
        });
        finish({});
        return;
      }
      const { passed, variables, message, evidence } = await dispatch(def, {
        runId,
        activityId,
        processKey,
        variables: { ...(runUserVariables.get(runId) ?? {}) },
      });
      const userVars = runUserVariables.get(runId) ?? {};
      for (const [k, v] of Object.entries(variables)) {
        if (!k.startsWith("__")) userVars[k] = v;
      }
      runUserVariables.set(runId, userVars);
      await upsertResult(processInstanceId, {
        activityId,
        status: passed ? "passed" : "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        message,
        evidence,
      });
      finish(variables);
    } catch (err) {
      const msg = (err as Error).message;
      await upsertResult(processInstanceId, {
        activityId,
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: msg,
      });
      fail(msg);
    }
  })();
};

interface DispatchOutput {
  passed: boolean;
  variables: Record<string, unknown>;
  message: string;
  evidence: Record<string, unknown>;
}

async function dispatch(
  def: TestDef,
  ctx: {
    runId: string;
    activityId: string;
    processKey: string;
    variables: Record<string, unknown>;
  },
): Promise<DispatchOutput> {
  if (def.type === "http.api") {
    const result = await runHttpTest(def);
    const variables: Record<string, unknown> = {};
    if (def.setVariables) {
      for (const [varName, source] of Object.entries(def.setVariables)) {
        if (source === "expect.passed") variables[varName] = result.passed;
      }
    }
    return {
      passed: result.passed,
      variables,
      message: result.reasons.join("; ") || "ok",
      evidence: {
        type: "http",
        request: def.request,
        response: { status: result.status, bodyPreview: result.bodyPreview },
        durationMs: result.durationMs,
      },
    };
  }
  if (def.type === "browser.playwright") {
    const result = await runBrowserTest(def, ctx);
    const variables: Record<string, unknown> = {};
    if (def.setVariables) {
      for (const [varName, source] of Object.entries(def.setVariables)) {
        if (source === "expect.passed") variables[varName] = result.passed;
      }
    }
    return {
      passed: result.passed,
      variables,
      message: result.reasons.join("; ") || "ok",
      evidence: {
        type: "browser",
        steps: result.steps,
        durationMs: result.durationMs,
      },
    };
  }
  if (def.type === "script.python") {
    const result = await runScriptTest(def, ctx);
    const variables: Record<string, unknown> = {};
    if (result.parsedResult?.setVariables) {
      for (const [k, v] of Object.entries(result.parsedResult.setVariables)) {
        if (!k.startsWith("__")) variables[k] = v;
      }
    }
    return {
      passed: result.passed,
      variables,
      message: result.reasons.join("; ") || "ok",
      evidence: {
        type: "script",
        language: "python",
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        parsedResult: result.parsedResult,
        logUrl: result.logUrl,
      },
    };
  }
  throw new Error(`unknown test type: ${(def as { type: string }).type}`);
}

export async function startNewRun(
  processKey: string,
  options?: { environment?: string; tag?: string },
): Promise<StartResult> {
  const proc = await getProcess(processKey);
  if (!proc) throw new Error(`unknown process: ${processKey}`);
  const source = proc.bpmnXml;
  const runId = crypto.randomUUID();
  const processInstanceId = crypto.randomUUID();
  const environment = options?.environment?.trim() || undefined;
  const tag = options?.tag?.trim() || undefined;

  const engine = Engine({
    name: `qa-flow-${runId}`,
    source,
    elements: { ServiceTask: QaServiceTask },
    variables: {
      __runId: runId,
      __processInstanceId: processInstanceId,
      __processKey: processKey,
      environment,
      tag,
    },
  });

  const listener = new EventEmitter();
  listener.on("activity.start", (api: { content?: { id?: string } }) => {
    const activityId = api.content?.id;
    if (!activityId) return;
    const run = activeRuns.get(runId);
    if (run && !run.visited.includes(activityId)) {
      run.visited.push(activityId);
    }
  });

  const record: RunRecord = {
    runId,
    processInstanceId,
    processKey,
    kind: "workflow",
    environment,
    tag,
    startedAt: new Date().toISOString(),
    results: {},
  };
  await createRun(record);

  activeRuns.set(runId, {
    runId,
    processInstanceId,
    processKey,
    startedAt: record.startedAt,
    visited: [],
  });
  runUserVariables.set(runId, {});

  const onDone = async () => {
    await markRunFinished(processInstanceId);
    const run = activeRuns.get(runId);
    if (run && !run.finishedAt) run.finishedAt = new Date().toISOString();
  };

  engine.on("end", onDone);
  engine.on("error", (err: Error) => {
    console.error(`[engine] run ${runId} error: ${err.message}`);
    onDone();
  });

  engine.execute({ listener }).catch((err: Error) => {
    console.error(`[engine] run ${runId} failed to start: ${err.message}`);
    onDone();
  });

  return { runId, processInstanceId, processKey };
}

export function getActiveRun(runId: string): ActiveRun | undefined {
  return activeRuns.get(runId);
}

export function isRunActive(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run) return false;
  return !run.finishedAt;
}
