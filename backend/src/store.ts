import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, RUNS_FILE } from "./config.ts";

export type TaskStatus = "pending" | "running" | "passed" | "failed" | "executed";

export interface TraceabilityRef {
  nodeId?: string;
  suiteId?: string;
  scenarioId?: string;
  caseId?: string;
  caseName?: string;
  dataSetId?: string;
  rowIndex?: number;
}

export interface TaskResult {
  activityId: string;
  status: TaskStatus;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  evidence?: Record<string, unknown>;
  traceability?: TraceabilityRef;
}

export type RunKind = "workflow" | "plan";

export interface RunRecord {
  runId: string;
  processInstanceId: string;
  processKey: string;
  kind?: RunKind;
  environment?: string;
  tag?: string;
  scope?: string;
  startedBy?: string;
  startedAt: string;
  finishedAt?: string;
  results: Record<string, TaskResult>;
}

interface StoreFile {
  runs: Record<string, RunRecord>;
}

let cache: StoreFile = { runs: {} };
let loaded = false;
let writeQueue: Promise<void> = Promise.resolve();

async function ensureLoaded() {
  if (loaded) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(RUNS_FILE, "utf8");
    cache = JSON.parse(raw) as StoreFile;
  } catch {
    cache = { runs: {} };
  }
  loaded = true;
}

function persist() {
  const snapshot = JSON.stringify(cache, null, 2);
  writeQueue = writeQueue.then(() => fs.writeFile(RUNS_FILE, snapshot, "utf8"));
  return writeQueue;
}

export async function createRun(record: RunRecord) {
  await ensureLoaded();
  cache.runs[record.runId] = record;
  await persist();
}

export async function getRun(runId: string): Promise<RunRecord | undefined> {
  await ensureLoaded();
  return cache.runs[runId];
}

export async function listRuns(): Promise<RunRecord[]> {
  await ensureLoaded();
  return Object.values(cache.runs).sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
}

export async function upsertResult(
  processInstanceId: string,
  result: TaskResult,
) {
  await ensureLoaded();
  const run = Object.values(cache.runs).find(
    (r) => r.processInstanceId === processInstanceId,
  );
  if (!run) return;
  run.results[result.activityId] = result;
  await persist();
}

export async function markRunFinished(processInstanceId: string) {
  await ensureLoaded();
  const run = Object.values(cache.runs).find(
    (r) => r.processInstanceId === processInstanceId,
  );
  if (!run || run.finishedAt) return;
  run.finishedAt = new Date().toISOString();
  await persist();
}
