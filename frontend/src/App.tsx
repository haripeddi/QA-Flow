import { useEffect, useRef, useState } from "react";
import BpmnCanvas from "./BpmnCanvas";
import {
  checkHealth,
  fetchProcess,
  fetchRun,
  startRun,
  type ActivityState,
  type ProcessInfo,
} from "./api";

export default function App() {
  const [proc, setProc] = useState<ProcessInfo | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityState[]>([]);
  const [active, setActive] = useState<boolean>(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    checkHealth().then(setHealthOk);
    fetchProcess()
      .then(setProc)
      .catch((e: Error) => setError(`Failed to load process: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetchRun(runId);
        if (cancelled) return;
        setActivities(r.activities);
        setActive(r.active);
        if (r.active) {
          pollTimer.current = window.setTimeout(tick, 800);
        }
      } catch (e) {
        if (!cancelled)
          setError(`Polling failed: ${(e as Error).message}`);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [runId]);

  const onStart = async () => {
    setError(null);
    setStarting(true);
    setActivities([]);
    setActive(false);
    try {
      const { runId } = await startRun();
      setRunId(runId);
      setActive(true);
    } catch (e) {
      setError(`Failed to start run: ${(e as Error).message}`);
    } finally {
      setStarting(false);
    }
  };

  const summary = summarize(activities);

  return (
    <div className="app">
      <header className="header">
        <h1>QA Flow &mdash; Order Fulfillment</h1>
        <div className="actions">
          <span
            className={`status-dot ${healthOk === null ? "" : healthOk ? "ok" : "bad"}`}
            title={healthOk ? "API healthy" : "API unreachable"}
          />
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {summary.passed} passed &middot; {summary.failed} failed &middot; {summary.running} running
          </span>
          <button className="primary" onClick={onStart} disabled={starting || active}>
            {active ? "Running..." : starting ? "Starting..." : "Start Run"}
          </button>
        </div>
      </header>
      <div className="diagram">
        {proc?.bpmnXml ? (
          <BpmnCanvas bpmnXml={proc.bpmnXml} activities={activities} />
        ) : (
          <div style={{ padding: 20 }}>
            {error ?? "Loading process model..."}
          </div>
        )}
      </div>
      <aside className="side">
        <h2>Activities</h2>
        {error && (
          <div style={{ color: "#991b1b", fontSize: 13, marginBottom: 8 }}>{error}</div>
        )}
        {activities.length === 0 && (
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            No run yet. Click <strong>Start Run</strong>.
          </div>
        )}
        {activities.map((a) => (
          <div className="activity" key={`${a.activityId}-${a.startTime}`}>
            <div className="row">
              <span className="name">{a.activityName ?? a.activityId}</span>
              <span className={`pill ${a.status}`}>{a.status}</span>
            </div>
            <div className="meta">
              {a.activityType}
              {a.durationInMillis != null ? ` · ${a.durationInMillis}ms` : ""}
            </div>
            {a.message && <div className="message">{a.message}</div>}
          </div>
        ))}
      </aside>
    </div>
  );
}

function summarize(activities: ActivityState[]) {
  let passed = 0, failed = 0, running = 0;
  for (const a of activities) {
    if (a.status === "passed") passed++;
    else if (a.status === "failed") failed++;
    else if (a.status === "running") running++;
  }
  return { passed, failed, running };
}
