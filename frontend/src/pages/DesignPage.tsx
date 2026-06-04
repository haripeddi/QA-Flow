import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import BpmnModeler, { type BpmnModelerHandle, type ElementInfo } from "../BpmnModeler";
import BpmnRunCanvas from "../BpmnRunCanvas";
import CopilotPanel from "../copilot/CopilotPanel";
import TestConfigPanel from "../TestConfigPanel";
import RunPanel from "../RunPanel";
import {
  checkHealth,
  createProcess,
  deleteProcess,
  fetchProcess,
  fetchProcesses,
  fetchRun,
  saveProcess,
  startRun,
  type ActivityState,
  type ProcessFullDef,
  type ProcessSummary,
  type TagsFile,
  type TestDef,
} from "../api";

type Mode = "design" | "run";

export default function DesignPage() {
  const { key: routeKey } = useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("design");
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
  const [proc, setProc] = useState<ProcessFullDef | null>(null);
  const [selected, setSelected] = useState<ElementInfo | null>(null);
  const [tags, setTags] = useState<TagsFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCopilot, setShowCopilot] = useState(false);

  const [runId, setRunId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityState[]>([]);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const modelerRef = useRef<BpmnModelerHandle | null>(null);

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
        const list = await fetchProcesses();
        if (cancelled) return;
        setProcesses(list);
        const key = routeKey ?? list[0]?.key;
        if (key) await openProcess(key, true);
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load processes: ${(e as Error).message}`);
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

  const refreshList = useCallback(async () => {
    const list = await fetchProcesses();
    setProcesses(list);
  }, []);

  const handleNew = async () => {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    const name = prompt("Name of the new process?", "My new process");
    if (!name) return;
    const suggested =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64) || "new_process";
    const key = prompt("Internal key (lowercase, a-z0-9_)", suggested);
    if (!key) return;
    const created = await createProcess({ key, name });
    await refreshList();
    await openProcess(created.key, true);
  };

  const handleDuplicate = async () => {
    if (!proc) return;
    const key = prompt(`Duplicate key for "${proc.name}"?`, `${proc.key}_copy`);
    if (!key) return;
    const created = await createProcess({ key, sourceKey: proc.key });
    await refreshList();
    await openProcess(created.key, true);
  };

  const handleDelete = async () => {
    if (!proc) return;
    if (!confirm(`Delete "${proc.name}"?`)) return;
    await deleteProcess(proc.key);
    setProc(null);
    setTags(null);
    await refreshList();
    navigate("/");
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
      await refreshList();
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [proc, tags, refreshList]);

  const handleStartRun = useCallback(async () => {
    if (!proc) return;
    if (dirty) {
      if (!confirm("Save and run?")) return;
      await handleSave();
    }
    setStarting(true);
    try {
      const { runId: id } = await startRun(proc.key);
      setRunId(id);
      setActive(true);
      setMode("run");
    } catch (e) {
      setError(`Failed to start run: ${(e as Error).message}`);
    } finally {
      setStarting(false);
    }
  }, [proc, dirty, handleSave]);

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
      navigate(`/process/${proc.key}/node/${el.id}`);
    },
    [navigate, proc],
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
    <div className="app">
      <header className="header">
        <div className="header-left">
          <select
            className="process-select"
            value={proc?.key ?? ""}
            onChange={(e) => openProcess(e.target.value)}
            disabled={starting || active}
          >
            {processes.length === 0 && <option value="">(no processes)</option>}
            {processes.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="process-actions">
            <button onClick={handleNew} type="button">+ New</button>
            <button onClick={handleDuplicate} disabled={!proc} type="button">Duplicate</button>
            <button onClick={handleDelete} disabled={!proc} className="danger" type="button">Delete</button>
          </div>
          <div className="mode-toggle">
            <button className={mode === "design" ? "mode-on" : ""} onClick={() => setMode("design")} type="button">Design</button>
            <button className={mode === "run" ? "mode-on" : ""} onClick={() => setMode("run")} type="button">Run</button>
          </div>
          <button type="button" onClick={() => setShowCopilot((v) => !v)} className={showCopilot ? "mode-on" : ""}>
            Copilot
          </button>
        </div>
        <div className="actions">
          <span className={`status-dot ${healthOk === null ? "" : healthOk ? "ok" : "bad"}`} />
          {dirty && <span className="dirty-badge">● unsaved</span>}
          <button onClick={handleSave} disabled={!proc || !dirty || saving} type="button">{saving ? "Saving..." : "Save"}</button>
          <button className="primary" onClick={handleStartRun} disabled={!proc || starting || active} type="button">
            {active ? "Running..." : "Start Run"}
          </button>
        </div>
      </header>

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
        {showCopilot && proc && mode === "design" && (
          <CopilotPanel
            processKey={proc.key}
            bpmnXml={proc.bpmnXml}
            selectedNodeId={selected?.id}
            selectedNodeName={selected?.name ?? undefined}
            onApplyBpmn={(xml) => {
              setProc({ ...proc, bpmnXml: xml });
              setDirty(true);
              void modelerRef.current?.importXml(xml);
            }}
          />
        )}
        {mode === "design" ? (
          <>
            {isServiceTask && selected && proc && (
              <button type="button" className="primary" style={{ marginBottom: 10, width: "100%" }} onClick={() => openAuthoring(selected)}>
                Open authoring workspace
              </button>
            )}
            <TestConfigPanel
              selectedId={selected?.id ?? null}
              selectedType={selected?.type ?? null}
              selectedName={selected?.name ?? null}
              test={selectedTest}
              isServiceTask={isServiceTask}
              onChange={onTestChange}
            />
          </>
        ) : (
          <RunPanel activities={activities} active={active} />
        )}
      </aside>
    </div>
  );
}
