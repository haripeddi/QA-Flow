import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { Engine } from "bpmn-engine";
import * as Elements from "bpmn-elements";
import { BPMN_FILE } from "./config.ts";
import { loadTags } from "./tags.ts";
import {
  createRun,
  markRunFinished,
  upsertResult,
  type RunRecord,
} from "./store.ts";
import { runHttpTest } from "./workers/http-worker.ts";

export interface StartResult {
  runId: string;
  processInstanceId: string;
  processKey: string;
}

interface ActiveRun {
  runId: string;
  processInstanceId: string;
  startedAt: string;
  finishedAt?: string;
  visited: string[];
}

const activeRuns = new Map<string, ActiveRun>();

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
    try {
      const tags = await loadTags();
      const def = tags.elementTests[activityId];
      if (!def) {
        if (processInstanceId) {
          await upsertResult(processInstanceId, {
            activityId,
            status: "executed",
            startedAt,
            finishedAt: new Date().toISOString(),
            message: "no test tagged; passing through",
          });
        }
        finish({});
        return;
      }
      const result = await runHttpTest(def);
      const variables: Record<string, unknown> = {};
      if (def.setVariables) {
        for (const [varName, source] of Object.entries(def.setVariables)) {
          if (source === "expect.passed") variables[varName] = result.passed;
        }
      }
      if (processInstanceId) {
        await upsertResult(processInstanceId, {
          activityId,
          status: result.passed ? "passed" : "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: result.reasons.join("; ") || "ok",
          evidence: {
            request: def.request,
            response: { status: result.status, bodyPreview: result.bodyPreview },
            durationMs: result.durationMs,
          },
        });
      }
      finish(variables);
    } catch (err) {
      const msg = (err as Error).message;
      if (processInstanceId) {
        await upsertResult(processInstanceId, {
          activityId,
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: msg,
        });
      }
      fail(msg);
    }
  })();
};

export async function startNewRun(): Promise<StartResult> {
  const tags = await loadTags();
  const source = await fs.readFile(BPMN_FILE, "utf8");
  const runId = crypto.randomUUID();
  const processInstanceId = crypto.randomUUID();

  const engine = Engine({
    name: `qa-flow-${runId}`,
    source,
    elements: { ServiceTask: QaServiceTask },
    variables: {
      __runId: runId,
      __processInstanceId: processInstanceId,
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
    processKey: tags.processKey,
    startedAt: new Date().toISOString(),
    results: {},
  };
  await createRun(record);

  activeRuns.set(runId, {
    runId,
    processInstanceId,
    startedAt: record.startedAt,
    visited: [],
  });

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

  return { runId, processInstanceId, processKey: tags.processKey };
}

export function getActiveRun(runId: string): ActiveRun | undefined {
  return activeRuns.get(runId);
}

export function isRunActive(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run) return false;
  return !run.finishedAt;
}
