export interface ActivityState {
  activityId: string;
  activityName: string | null;
  activityType: string;
  startTime: string;
  endTime: string | null;
  durationInMillis: number | null;
  status: "pending" | "running" | "passed" | "failed" | "executed";
  message?: string;
  evidence?: Record<string, unknown>;
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

export interface ProcessInfo {
  processKey: string;
  bpmnXml: string;
  tags: { processKey: string; elementTests: Record<string, { name: string }> };
}

const base = "";

export async function fetchProcess(): Promise<ProcessInfo> {
  const res = await fetch(`${base}/api/process`);
  if (!res.ok) throw new Error(`process fetch: ${res.status}`);
  return res.json();
}

export async function startRun(): Promise<{ runId: string }> {
  const res = await fetch(`${base}/api/runs`, { method: "POST" });
  if (!res.ok) throw new Error(`start run: ${res.status}`);
  return res.json();
}

export async function fetchRun(runId: string): Promise<RunState> {
  const res = await fetch(`${base}/api/runs/${runId}`);
  if (!res.ok) throw new Error(`fetch run: ${res.status}`);
  return res.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
