import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createProcess,
  fetchUseCases,
  type UseCaseSummary,
} from "../api";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "new_process"
  );
}

export default function UseCaseListPage() {
  const navigate = useNavigate();
  const [useCases, setUseCases] = useState<UseCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchUseCases();
      setUseCases(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleNew = async () => {
    const name = prompt("Name of the new use case?", "My new use case");
    if (!name) return;
    const key = prompt("Internal key (lowercase, a-z0-9_)", slugify(name));
    if (!key) return;
    try {
      const created = await createProcess({ key, name });
      navigate(`/process/${created.key}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const filtered = useCases.filter((u) =>
    `${u.name} ${u.key}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="usecases-page">
      <div className="usecases-head">
        <div>
          <h1>Use Cases</h1>
          <p className="usecases-sub">
            Design BPMN-driven test workflows and track their coverage and
            execution health.
          </p>
        </div>
        <div className="usecases-head-actions">
          <input
            className="usecases-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search use cases…"
          />
          <button type="button" className="primary" onClick={handleNew}>
            + New use case
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error} <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {loading ? (
        <div className="usecases-empty">Loading use cases…</div>
      ) : filtered.length === 0 ? (
        <div className="usecases-empty">
          {useCases.length === 0
            ? "No use cases yet. Create your first one to get started."
            : "No use cases match your search."}
        </div>
      ) : (
        <div className="usecases-grid">
          {filtered.map((u) => (
            <UseCaseCard
              key={u.key}
              uc={u}
              onOpen={() => navigate(`/process/${u.key}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UseCaseCard({
  uc,
  onOpen,
}: {
  uc: UseCaseSummary;
  onOpen: () => void;
}) {
  const executed = uc.passed + uc.failed;
  const passRate =
    executed > 0 ? Math.round((uc.passed / executed) * 100) : null;

  return (
    <button type="button" className="usecase-card" onClick={onOpen}>
      <div className="usecase-card-top">
        <h3>{uc.name}</h3>
        <span className="usecase-key">{uc.key}</span>
      </div>
      {uc.description && (
        <p className="usecase-desc">{uc.description}</p>
      )}

      <div className="usecase-metrics">
        <div className="metric">
          <span className="metric-value">{uc.testCaseCount}</span>
          <span className="metric-label">Test cases</span>
        </div>
        <div className="metric">
          <span className="metric-value">{uc.automatedCount}</span>
          <span className="metric-label">Automated</span>
        </div>
        <div className="metric">
          <span className="metric-value">{uc.manualCount}</span>
          <span className="metric-label">Manual</span>
        </div>
      </div>

      <div className="usecase-status">
        <span className="pill pill-pass">{uc.passed} passed</span>
        <span className="pill pill-fail">{uc.failed} failed</span>
        <span className="pill pill-idle">{uc.notRun} not run</span>
      </div>

      {uc.testCaseCount > 0 && (
        <div className="usecase-bar">
          <div
            className="bar-pass"
            style={{ width: `${(uc.passed / uc.testCaseCount) * 100}%` }}
          />
          <div
            className="bar-fail"
            style={{ width: `${(uc.failed / uc.testCaseCount) * 100}%` }}
          />
          <div
            className="bar-idle"
            style={{ width: `${(uc.notRun / uc.testCaseCount) * 100}%` }}
          />
        </div>
      )}

      <div className="usecase-foot">
        <span>
          {passRate === null ? "Not executed yet" : `${passRate}% pass rate`}
        </span>
        <span>
          {uc.lastRunAt
            ? `Last run ${new Date(uc.lastRunAt).toLocaleDateString()}`
            : `${uc.nodeCount} node${uc.nodeCount === 1 ? "" : "s"}`}
        </span>
      </div>
    </button>
  );
}
