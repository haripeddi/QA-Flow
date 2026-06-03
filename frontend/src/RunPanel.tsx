import {
  isBrowserEvidence,
  isScriptEvidence,
  resolveAssetUrl,
  type ActivityState,
} from "./api";

interface Props {
  activities: ActivityState[];
  active: boolean;
}

export default function RunPanel({ activities, active }: Props) {
  if (activities.length === 0) {
    return (
      <div className="config-empty">
        <h3>No run yet</h3>
        <p>Click <strong>Start Run</strong> to execute this process. Activities will appear here as they run, and the diagram will light up.</p>
      </div>
    );
  }
  return (
    <div className="run-panel">
      <div className="run-summary">
        {summarize(activities)}
        {active && <span className="pill running">running</span>}
      </div>
      {activities.map((a) => (
        <ActivityCard key={`${a.activityId}-${a.startTime}`} a={a} />
      ))}
    </div>
  );
}

function ActivityCard({ a }: { a: ActivityState }) {
  const browserSteps = isBrowserEvidence(a.evidence) ? a.evidence.steps : null;
  const script = isScriptEvidence(a.evidence) ? a.evidence : null;
  return (
    <div className="activity">
      <div className="row">
        <span className="name">{a.activityName ?? a.activityId}</span>
        <span className={`pill ${a.status}`}>{a.status}</span>
      </div>
      <div className="meta">
        {a.activityType}
        {a.durationInMillis != null ? ` · ${a.durationInMillis}ms` : ""}
        {script ? ` · ${script.language} · exit ${script.exitCode ?? "?"}` : ""}
      </div>
      {a.message && a.message !== "ok" && (
        <div className="message">{a.message}</div>
      )}
      {script && (
        <div className="script-evidence">
          {script.timedOut && (
            <div className="script-warning">timed out</div>
          )}
          {script.stdout && (
            <details open>
              <summary>stdout</summary>
              <pre className="script-output">{script.stdout}</pre>
            </details>
          )}
          {script.stderr && (
            <details open={!script.stdout}>
              <summary>stderr</summary>
              <pre className="script-output script-stderr">{script.stderr}</pre>
            </details>
          )}
          {script.parsedResult?.setVariables && (
            <details>
              <summary>set variables</summary>
              <pre className="script-output">
                {JSON.stringify(script.parsedResult.setVariables, null, 2)}
              </pre>
            </details>
          )}
          {(() => {
            const ev = script.parsedResult?.evidence as
              | { screenshots?: Array<{ label?: string; url?: string }> }
              | undefined;
            const shots = Array.isArray(ev?.screenshots) ? ev.screenshots : [];
            const valid = shots.filter((s) => s && s.url);
            if (!valid.length) return null;
            return (
              <div className="script-shots">
                {valid.map((s, i) => (
                  <a
                    key={i}
                    href={resolveAssetUrl(s.url as string)}
                    target="_blank"
                    rel="noreferrer"
                    className="shot"
                  >
                    <img
                      src={resolveAssetUrl(s.url as string)}
                      alt={s.label ?? `screenshot ${i + 1}`}
                    />
                    {s.label && <span className="shot-label">{s.label}</span>}
                  </a>
                ))}
              </div>
            );
          })()}
          {script.logUrl && (
            <a
              className="log-link"
              href={resolveAssetUrl(script.logUrl)}
              target="_blank"
              rel="noreferrer"
            >
              Download full run log
            </a>
          )}
        </div>
      )}
      {browserSteps && browserSteps.length > 0 && (
        <div className="steps">
          {browserSteps.map((s, i) => (
            <div key={`${s.index}-${i}`} className={`step step-${s.status}`}>
              <div className="step-head">
                <span className="step-label">
                  {s.action}
                  {s.name ? ` · ${s.name}` : ""}
                </span>
                <span className={`pill ${s.status}`}>{s.status}</span>
              </div>
              {s.message && <div className="step-msg">{s.message}</div>}
              {s.screenshotUrl && (
                <a
                  className="shot-link"
                  href={resolveAssetUrl(s.screenshotUrl)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    className="shot"
                    src={resolveAssetUrl(s.screenshotUrl)}
                    alt={s.name ?? "screenshot"}
                  />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
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
  return (
    <span style={{ fontSize: 12, color: "#6b7280" }}>
      {passed} passed · {failed} failed · {running} running
    </span>
  );
}
