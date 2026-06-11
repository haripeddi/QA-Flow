import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import BpmnModeler, { type BpmnModelerHandle, type ElementInfo } from "../BpmnModeler";
import BpmnRunCanvas from "../BpmnRunCanvas";
import TestConfigPanel from "../TestConfigPanel";
import RunPanel from "../RunPanel";
import NodeTestDrawer from "../authoring/NodeTestDrawer";
import {
  checkHealth,
  createProcess,
  deleteProcess,
  fetchProcess,
  fetchRun,
  renameProcess,
  saveProcess,
  startRun,
  type ActivityState,
  type ProcessFullDef,
  type TagsFile,
  type TestDef,
} from "../api";

type Mode = "design" | "run";

export default function DesignPage() {
  const { key: routeKey } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("design");
  const [proc, setProc] = useState<ProcessFullDef | null>(null);
  const [selected, setSelected] = useState<ElementInfo | null>(null);
  const [tags, setTags] = useState<TagsFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityState[]>([]);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runEnv, setRunEnv] = useState("staging");
  const [runTag, setRunTag] = useState("");
  const pollTimer = useRef<number | null>(null);
  const modelerRef = useRef<BpmnModelerHandle | null>(null);

  const creatorLabel = proc?.createdByName ?? proc?.createdBy;
  const canDelete =
    !user ||
    !proc?.createdBy ||
    proc.createdBy.toLowerCase() === user.email.toLowerCase();

  const openProcess = useCallback(
    async (key: string, skipConfirm = false) => {
      if (!skipConfirm && dirty) {
        const ok = confirm("You have unsaved changes. Discard them?");
        if (!ok) return;
      }
      try {
        const p = await fetchProcess(key);
        setProc(p);
        setTags(p.tags);
        setDirty(false);
        setSelected(null);
        setActivities([]);
        setRunId(null);
        setActive(false);
        setError(null);
        navigate(`/process/${key}`);
      } catch (e) {
        setError(`Failed to open: ${(e as Error).message}`);
      }
    },
    [dirty, navigate],
  );

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      checkHealth().then((ok) => {
        if (!cancelled) setHealthOk(ok);
      });
      try {
        if (routeKey) await openProcess(routeKey, true);
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load process: ${(e as Error).message}`);
        }
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!routeKey || !proc || proc.key === routeKey) return;
    void openProcess(routeKey, true);
  }, [routeKey, proc, openProcess]);

  const handleRename = async () => {
    if (!proc) return;
    const name = prompt("Rename use case", proc.name);
    if (!name || !name.trim() || name.trim() === proc.name) return;
    try {
      const saved = await renameProcess(proc.key, name.trim());
      setProc((prev) => (prev ? { ...prev, name: saved.name } : prev));
    } catch (e) {
      setError(`Rename failed: ${(e as Error).message}`);
    }
  };

  const handleDuplicate = async () => {
    if (!proc) return;
    const key = prompt(`Duplicate key for "${proc.name}"?`, `${proc.key}_copy`);
    if (!key) return;
    const created = await createProcess({ key, sourceKey: proc.key });
    await openProcess(created.key, true);
  };

  const handleDelete = async () => {
    if (!proc) return;
    if (!canDelete) {
      setError("Only the creator can delete this use case.");
      return;
    }
    if (!confirm(`Delete "${proc.name}"?`)) return;
    try {
      await deleteProcess(proc.key);
      setProc(null);
      setTags(null);
      navigate("/");
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`);
    }
  };

  const handleSave = useCallback(async () => {
    if (!proc || !tags || !modelerRef.current) return;
    setSaving(true);
    try {
      const xml = await modelerRef.current.saveXml();
      const saved = await saveProcess(proc.key, { bpmnXml: xml, tags });
      setProc(saved);
      setTags(saved.tags);
      setDirty(false);
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [proc, tags]);

  const openRunModal = useCallback(() => {
    if (!proc) return;
    setShowRunModal(true);
  }, [proc]);

  const confirmStartRun = useCallback(async () => {
    if (!proc) return;
    if (dirty) {
      await handleSave();
    }
    setShowRunModal(false);
    setStarting(true);
    try {
      const { runId: id } = await startRun(proc.key, {
        environment: runEnv,
        tag: runTag,
      });
      setRunId(id);
      setActive(true);
      setMode("run");
    } catch (e) {
      setError(`Failed to start run: ${(e as Error).message}`);
    } finally {
      setStarting(false);
    }
  }, [proc, dirty, handleSave, runEnv, runTag]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      const r = await fetchRun(runId);
      if (cancelled) return;
      setActivities(r.activities);
      setActive(r.active);
      if (r.active) pollTimer.current = window.setTimeout(tick, 800);
    };
    tick();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [runId]);

  const isServiceTask = useMemo(() => {
    if (!selected?.type) return false;
    return /Task$/.test(selected.type) && selected.type !== "bpmn:SubProcess";
  }, [selected]);

  const openAuthoring = useCallback(
    (el: ElementInfo) => {
      if (!proc || !/Task$/.test(el.type ?? "")) return;
    },
    [proc],
  );

  const selectedTest: TestDef | undefined = useMemo(() => {
    if (!selected?.id || !tags) return undefined;
    return tags.elementTests[selected.id] as TestDef | undefined;
  }, [selected, tags]);

  const onTestChange = (test: TestDef | null) => {
    if (!tags || !selected?.id) return;
    const next = { ...tags.elementTests };
    if (test === null) delete next[selected.id];
    else next[selected.id] = test;
    setTags({ ...tags, elementTests: next });
    setDirty(true);
  };

  const onElementRename = useCallback(
    (oldId: string, newId: string) => {
      if (!tags) return;
      const elt = tags.elementTests[oldId];
      if (!elt) return;
      const next = { ...tags.elementTests };
      delete next[oldId];
      next[newId] = elt;
      setTags({ ...tags, elementTests: next });
      setDirty(true);
    },
    [tags],
  );

  return (
    <div className={`app ${mode === "design" && isServiceTask ? "authoring-open" : ""}`}>
      <header className="header">
        <div className="header-left">
          <Link to="/" className="back-link" title="Back to use cases">
            ←
          </Link>
          <div className="usecase-title">
            <h2>
              {proc?.name ?? "Loading…"}
              {proc && (
                <button
                  type="button"
                  className="rename-inline"
                  title="Rename use case"
                  onClick={handleRename}
                >
                  ✎
                </button>
              )}
            </h2>
            {proc && (
              <span className="usecase-title-key">
                {proc.key}
                {creatorLabel && (
                  <span className="usecase-title-owner">
                    Created by {creatorLabel}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="process-actions">
            <button onClick={handleRename} disabled={!proc} type="button">Rename</button>
            <button onClick={handleDuplicate} disabled={!proc} type="button">Duplicate</button>
            <button
              onClick={handleDelete}
              disabled={!proc || !canDelete}
              className="danger"
              type="button"
              title={
                canDelete
                  ? "Delete use case"
                  : `Only ${creatorLabel ?? "the creator"} can delete this`
              }
            >
              Delete
            </button>
          </div>
          <div className="mode-toggle">
            <button className={mode === "design" ? "mode-on" : ""} onClick={() => setMode("design")} type="button">Design</button>
            <button className={mode === "run" ? "mode-on" : ""} onClick={() => setMode("run")} type="button">Run</button>
          </div>
        </div>
        <div className="actions">
          <span className={`status-dot ${healthOk === null ? "" : healthOk ? "ok" : "bad"}`} />
          {dirty && <span className="dirty-badge">● unsaved</span>}
          <button onClick={handleSave} disabled={!proc || !dirty || saving} type="button">{saving ? "Saving..." : "Save"}</button>
          <button className="primary" onClick={openRunModal} disabled={mode === "design" || !proc || starting || active} type="button">
            {active ? "Running..." : "Start Run"}
          </button>
        </div>
      </header>

      {showRunModal && (
        <div className="modal-overlay" onClick={() => setShowRunModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Start a new run</h3>
            <p className="modal-sub">
              Configure how this run of <strong>{proc?.name}</strong> should
              execute.
            </p>
            <div className="field">
              <label>Environment</label>
              <select value={runEnv} onChange={(e) => setRunEnv(e.target.value)}>
                <option value="local">local</option>
                <option value="dev">dev</option>
                <option value="qa">qa</option>
                <option value="staging">staging</option>
                <option value="production">production</option>
              </select>
            </div>
            <div className="field">
              <label>Tag / label (optional)</label>
              <input
                value={runTag}
                onChange={(e) => setRunTag(e.target.value)}
                placeholder="e.g. smoke, regression, release-2.4"
              />
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowRunModal(false)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={confirmStartRun}>
                Start run
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="canvas-wrap">
        {error && <div className="error-banner">{error} <button onClick={() => setError(null)}>×</button></div>}
        {proc && mode === "design" && (
          <BpmnModeler
            ref={modelerRef}
            initialXml={proc.bpmnXml}
            onSelection={setSelected}
            onChange={() => setDirty(true)}
            onElementRename={onElementRename}
            onElementDblClick={openAuthoring}
          />
        )}
        {proc && mode === "run" && <BpmnRunCanvas bpmnXml={proc.bpmnXml} activities={activities} />}
      </div>

      <aside className="side">
        {mode === "design" ? (
          <>
            {isServiceTask && selected && proc && (
              <NodeTestDrawer
                processKey={proc.key}
                nodeId={selected.id}
                nodeName={selected.name}
                predecessorIds={parsePredecessors(proc.bpmnXml, selected.id)}
                variant="panel"
              />
            )}
            {(!isServiceTask || !selected || !proc) && (
              <TestConfigPanel
                selectedId={selected?.id ?? null}
                selectedType={selected?.type ?? null}
                selectedName={selected?.name ?? null}
                test={selectedTest}
                isServiceTask={isServiceTask}
                onChange={onTestChange}
              />
            )}
          </>
        ) : (
          <RunPanel activities={activities} active={active} />
        )}
      </aside>
    </div>
  );
}

/**
 * Walk the BPMN sequence flows backward from `nodeId` to find every upstream
 * (ancestor) flow node. Used to surface previous nodes' output parameters as
 * available inputs for the current node.
 */
function parsePredecessors(bpmnXml: string, nodeId: string): string[] {
  const incoming = new Map<string, string[]>();
  const flowRe =
    /<bpmn:sequenceFlow\b[^>]*\bsourceRef="([^"]+)"[^>]*\btargetRef="([^"]+)"|<bpmn:sequenceFlow\b[^>]*\btargetRef="([^"]+)"[^>]*\bsourceRef="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = flowRe.exec(bpmnXml)) !== null) {
    const source = m[1] ?? m[4];
    const target = m[2] ?? m[3];
    if (!source || !target) continue;
    const list = incoming.get(target) ?? [];
    list.push(source);
    incoming.set(target, list);
  }
  const ancestors = new Set<string>();
  const queue = [...(incoming.get(nodeId) ?? [])];
  while (queue.length) {
    const cur = queue.shift()!;
    if (ancestors.has(cur)) continue;
    ancestors.add(cur);
    for (const prev of incoming.get(cur) ?? []) queue.push(prev);
  }
  return [...ancestors];
}
