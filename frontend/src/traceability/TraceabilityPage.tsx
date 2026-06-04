import { useEffect, useState } from "react";
import {
  fetchTraceability,
  type TraceabilityResponse,
  type TraceabilityView,
} from "../api";

export default function TraceabilityPage() {
  const [view, setView] = useState<TraceabilityView>("workflow_to_case");
  const [data, setData] = useState<TraceabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTraceability(view)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [view]);

  const insights = data?.insights;

  return (
    <div className="trace-page">
      <header className="trace-header">
        <h2>Traceability Matrix</h2>
        <select value={view} onChange={(e) => setView(e.target.value as TraceabilityView)}>
          <option value="workflow_to_suite">Workflow → Suite</option>
          <option value="workflow_to_scenario">Workflow → Scenario</option>
          <option value="workflow_to_case">Workflow → Test Case</option>
          <option value="case_to_workflow">Test Case → Workflow</option>
          <option value="case_to_results">Test Case → Results</option>
        </select>
      </header>
      {error && <div className="error-banner">{error}</div>}
      {insights && (
        <div className="trace-insights">
          <div className="insight-card"><strong>{insights.workflowsCreated}</strong><span>Workflows</span></div>
          <div className="insight-card"><strong>{insights.workflowsExecuted}</strong><span>Executed</span></div>
          <div className="insight-card"><strong>{insights.casesCreated}</strong><span>Test cases</span></div>
          <div className="insight-card"><strong>{insights.casesExecuted}</strong><span>Cases run</span></div>
          <div className="insight-card pass"><strong>{insights.passed}</strong><span>Passed</span></div>
          <div className="insight-card fail"><strong>{insights.failed}</strong><span>Failed</span></div>
        </div>
      )}
      <div className="trace-matrix-wrap">
        <table className="trace-matrix">
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Node</th>
              <th>Case</th>
              <th>Last status</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r, i) => (
              <tr key={i}>
                <td>{r.workflowName}</td>
                <td>{r.nodeId ?? "—"}</td>
                <td>{r.caseName ?? "—"}</td>
                <td><span className={`pill ${r.lastStatus ?? ""}`}>{r.lastStatus ?? "—"}</span></td>
                <td>{r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {insights && insights.coverageGaps.length > 0 && (
        <section className="trace-gaps">
          <h3>Coverage gaps ({insights.coverageGaps.length})</h3>
          <ul>
            {insights.coverageGaps.slice(0, 20).map((g, i) => (
              <li key={i}>{g.processKey} / {g.nodeId}: {g.reason}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
