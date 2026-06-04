import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listRuns } from "../api";

export default function TestRunsPage() {
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof listRuns>>>([]);

  useEffect(() => {
    listRuns().then(setRuns).catch(console.error);
  }, []);

  return (
    <div className="runs-page">
      <h2>Test Runs</h2>
      <table className="trace-matrix">
        <thead>
          <tr>
            <th>Run ID</th>
            <th>Process</th>
            <th>Kind</th>
            <th>Environment</th>
            <th>Started</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            if (!r) return null;
            const results = Object.values(r.results ?? {});
            const failed = results.filter((x) => x.status === "failed").length;
            const passed = results.filter((x) => x.status === "passed").length;
            return (
              <tr key={r.runId}>
                <td><Link to={`/runs/${r.runId}`}>{r.runId.slice(0, 8)}…</Link></td>
                <td>{r.processKey}</td>
                <td>{r.kind ?? "workflow"}</td>
                <td>{r.environment ?? "—"}</td>
                <td>{new Date(r.startedAt).toLocaleString()}</td>
                <td>{passed} passed / {failed} failed {r.finishedAt ? "" : "(running)"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
