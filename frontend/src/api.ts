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

export interface ActivityState {
  activityId: string;
  activityName: string | null;
  activityType: string;
  startTime: string;
  endTime: string | null;
  durationInMillis: number | null;
  status: "pending" | "running" | "passed" | "failed" | "executed";
  message?: string;
  evidence?:
    | BrowserEvidence
    | HttpEvidence
    | ScriptEvidence
    | Record<string, unknown>;
}

export interface RunState {
  run: {
    runId: string;
    processInstanceId: string;
    processKey: string;
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

export async function startRun(processKey: string): Promise<{ runId: string }> {
  return jsonOrThrow(
    await apiFetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ processKey }),
    }),
  );
}

export async function fetchRun(runId: string): Promise<RunState> {
  return jsonOrThrow(await apiFetch(`/api/runs/${runId}`));
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
