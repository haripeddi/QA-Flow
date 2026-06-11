import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createProcess,
  deleteProcess,
  fetchUseCases,
  type UseCaseSummary,
} from "../api";
import { useAuth, type AuthUser } from "../auth";

function canDelete(uc: UseCaseSummary, user: AuthUser | null): boolean {
  if (!user) return true; // auth disabled: backend allows all
  if (!uc.createdBy) return true; // seeded / unowned
  return uc.createdBy.toLowerCase() === user.email.toLowerCase();
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "new_process"
  );
}

// Business-facing descriptions for known seeded use cases so the template
// gallery reads like a product catalogue rather than internal keys.
const TEMPLATE_BLURBS: Record<string, string> = {
  career_site_experience:
    "Validate the candidate-facing career site journey — home, job search, and the apply funnel conversion path.",
  talent_crm_pipeline:
    "Exercise the Talent CRM lead-capture and nurture pipeline, from talent community sign-up to engagement.",
  applied_ai_hiring:
    "Smoke-test AI-driven candidate matching, screening, and intelligent shortlisting flows.",
  hr_resources_hub:
    "Cover the HR resources & content hub navigation, gated assets, and lead generation.",
  customer_success_stories:
    "Verify customer proof points, success stories, and case-study browsing experiences.",
  order_fulfillment:
    "End-to-end order intake, payment authorization, and fulfillment API regression suite.",
  google_ai_search:
    "Browser journey covering AI-powered search relevance and results rendering.",
};

const BLANK_TEMPLATE = "__blank__";

export default function UseCaseListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [useCases, setUseCases] = useState<UseCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [template, setTemplate] = useState<string>(BLANK_TEMPLATE);
  const [creating, setCreating] = useState(false);

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

  const openNew = () => {
    setNewName("");
    setNewKey("");
    setKeyEdited(false);
    setTemplate(BLANK_TEMPLATE);
    setShowNew(true);
  };

  const onNameChange = (value: string) => {
    setNewName(value);
    if (!keyEdited) setNewKey(slugify(value));
  };

  const pickTemplate = (key: string) => {
    setTemplate(key);
    if (key !== BLANK_TEMPLATE && !newName.trim()) {
      const tpl = useCases.find((u) => u.key === key);
      if (tpl) {
        const name = `${tpl.name} (copy)`;
        setNewName(name);
        if (!keyEdited) setNewKey(slugify(name));
      }
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    const key = (newKey.trim() || slugify(name)).toLowerCase();
    if (!name || !key) return;
    setCreating(true);
    try {
      const created = await createProcess(
        template === BLANK_TEMPLATE
          ? { key, name }
          : { key, name, sourceKey: template },
      );
      setShowNew(false);
      navigate(`/process/${created.key}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (uc: UseCaseSummary) => {
    if (
      !confirm(
        `Delete "${uc.name}"? This removes its workflow, test plan and tags.`,
      )
    )
      return;
    try {
      await deleteProcess(uc.key);
      await load();
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
          <button type="button" className="primary" onClick={openNew}>
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
              deletable={canDelete(u, user)}
              onOpen={() => navigate(`/process/${u.key}`)}
              onDelete={() => handleDelete(u)}
            />
          ))}
        </div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Create a new use case</h3>
            <p className="modal-sub">
              Name your use case and start from a blank canvas or an existing
              business template.
            </p>

            <div className="new-fields">
              <div className="field">
                <label>Use case name</label>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder="e.g. Candidate Apply Flow"
                />
              </div>
              <div className="field">
                <label>Internal key</label>
                <input
                  value={newKey}
                  onChange={(e) => {
                    setKeyEdited(true);
                    setNewKey(e.target.value);
                  }}
                  placeholder="candidate_apply_flow"
                />
              </div>
            </div>

            <div className="template-section">
              <label className="template-label">Start from a template</label>
              <div className="template-gallery">
                <button
                  type="button"
                  className={`template-card ${
                    template === BLANK_TEMPLATE ? "template-on" : ""
                  }`}
                  onClick={() => pickTemplate(BLANK_TEMPLATE)}
                >
                  <span className="template-emoji">＋</span>
                  <span className="template-name">Blank canvas</span>
                  <span className="template-blurb">
                    Start from an empty BPMN canvas and model the flow yourself.
                  </span>
                </button>
                {useCases.map((u) => (
                  <button
                    key={u.key}
                    type="button"
                    className={`template-card ${
                      template === u.key ? "template-on" : ""
                    }`}
                    onClick={() => pickTemplate(u.key)}
                  >
                    <span className="template-name">{u.name}</span>
                    <span className="template-blurb">
                      {TEMPLATE_BLURBS[u.key] ??
                        u.description ??
                        "Reuse this workflow and its test plan as a starting point."}
                    </span>
                    <span className="template-meta">
                      {u.testCaseCount} test case
                      {u.testCaseCount === 1 ? "" : "s"} ·{" "}
                      {u.nodeCount} node{u.nodeCount === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" onClick={() => setShowNew(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleCreate}
                disabled={creating || !newName.trim() || !newKey.trim()}
              >
                {creating ? "Creating…" : "Create use case"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UseCaseCard({
  uc,
  deletable,
  onOpen,
  onDelete,
}: {
  uc: UseCaseSummary;
  deletable: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const executed = uc.passed + uc.failed;
  const passRate =
    executed > 0 ? Math.round((uc.passed / executed) * 100) : null;
  const creator = uc.createdByName ?? uc.createdBy;

  return (
    <div
      className="usecase-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="usecase-card-top">
        <h3>{uc.name}</h3>
        <span className="usecase-key">{uc.key}</span>
        <button
          type="button"
          className="usecase-delete"
          title={
            deletable
              ? "Delete use case"
              : `Only ${creator ?? "the creator"} can delete this`
          }
          disabled={!deletable}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
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

      <div className="usecase-people">
        <span title={uc.createdBy}>
          Created by <strong>{creator ?? "Unassigned"}</strong>
        </span>
        {uc.lastRunBy && (
          <span title={uc.lastRunBy}>
            Last run by <strong>{uc.lastRunBy}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
