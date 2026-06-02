import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BpmnModeler, { type BpmnModelerHandle, type ElementInfo } from "./BpmnModeler";
import BpmnRunCanvas from "./BpmnRunCanvas";
import TestConfigPanel from "./TestConfigPanel";
import RunPanel from "./RunPanel";
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
} from "./api";

type Mode = "design" | "run";

export default function App() {
  const [mode, setMode] = useState<Mode>("design");
  const [processes, setProcesses] = useState<ProcessSummary[]>([]);
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
  const pollTimer = useRef<number | null>(null);

  const modelerRef = useRef<BpmnModelerHandle | null>(null);

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
        if (list.length > 0) {
          const first = await fetchProcess(list[0].key);
          if (cancelled) return;
          setProc(first);
          setTags(first.tags);
          setDirty(false);
          setSelected(null);
        }
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
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const list = await fetchProcesses();
      setProcesses(list);
    } catch (e) {
      setError(`Failed to load processes: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProcess = useCallback(
    async (key: string) => {
      if (dirty) {
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
      } catch (e) {
        setError(`Failed to open: ${(e as Error).message}`);
      }
    },
    [dirty],
  );

  const handleNew = async () => {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    const name = prompt("Name of the new process (human-friendly)?", "My new process");
    if (!name) return;
    const suggested = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "new_process";
    const key = prompt(
      "Internal key (lowercase, letters/digits/underscore, 2-64)",
      suggested,
    );
    if (!key) return;
    try {
      const created = await createProcess({ key, name });
      await refreshList();
      await openProcess(created.key);
    } catch (e) {
      setError(`Create failed: ${(e as Error).message}`);
    }
  };

  const handleDuplicate = async () => {
    if (!proc) return;
    const key = prompt(`Key for the duplicate of "${proc.name}"?`, `${proc.key}_copy`);
    if (!key) return;
    try {
      const created = await createProcess({ key, sourceKey: proc.key });
      await refreshList();
      await openProcess(created.key);
    } catch (e) {
      setError(`Duplicate failed: ${(e as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (!proc) return;
    if (!confirm(`Delete process "${proc.name}" (${proc.key})? This is irreversible.`)) return;
    try {
      await deleteProcess(proc.key);
      setProc(null);
      setTags(null);
      setDirty(false);
      await refreshList();
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`);
    }
  };

  const handleSave = useCallback(async () => {
    if (!proc || !tags) return;
    if (!modelerRef.current) return;
    setSaving(true);
    setError(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proc, tags]);

  const handleStartRun = useCallback(async () => {
    if (!proc) return;
    if (dirty) {
      const ok = confirm("You have unsaved changes. Save and run?");
      if (!ok) return;
      await handleSave();
    }
    setStarting(true);
    setActivities([]);
    setActive(false);
    setError(null);
    try {
      const { runId } = await startRun(proc.key);
      setRunId(runId);
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
      try {
        const r = await fetchRun(runId);
        if (cancelled) return;
        setActivities(r.activities);
        setActive(r.active);
        if (r.active) {
          pollTimer.current = window.setTimeout(tick, 800);
        }
      } catch (e) {
        if (!cancelled) setError(`Polling failed: ${(e as Error).message}`);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [runId]);

  const onSelection = useCallback((info: ElementInfo | null) => {
    setSelected(info);
  }, []);

  const onModelChange = useCallback(() => {
    setDirty(true);
  }, []);

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

  const isServiceTask = useMemo(() => {
    if (!selected?.type) return false;
    return /Task$/.test(selected.type) && selected.type !== "bpmn:SubProcess";
  }, [selected]);

  const selectedTest: TestDef | undefined = useMemo(() => {
    if (!selected?.id || !tags) return undefined;
    return tags.elementTests[selected.id] as TestDef | undefined;
  }, [selected, tags]);

  const onTestChange = (test: TestDef | null) => {
    if (!tags || !selected?.id) return;
    const next = { ...tags.elementTests };
    if (test === null) {
      delete next[selected.id];
    } else {
      next[selected.id] = test;
    }
    setTags({ ...tags, elementTests: next });
    setDirty(true);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>QA Flow</h1>
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
            <button
              className={mode === "design" ? "mode-on" : ""}
              onClick={() => setMode("design")}
              type="button"
            >Design</button>
            <button
              className={mode === "run" ? "mode-on" : ""}
              onClick={() => setMode("run")}
              type="button"
            >Run</button>
          </div>
        </div>
        <div className="actions">
          <span
            className={`status-dot ${healthOk === null ? "" : healthOk ? "ok" : "bad"}`}
            title={healthOk ? "API healthy" : "API unreachable"}
          />
          {dirty && <span className="dirty-badge">● unsaved</span>}
          <button
            onClick={handleSave}
            disabled={!proc || !dirty || saving}
            type="button"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            className="primary"
            onClick={handleStartRun}
            disabled={!proc || starting || active}
            type="button"
          >
            {active ? "Running..." : starting ? "Starting..." : "Start Run"}
          </button>
        </div>
      </header>

      <div className="canvas-wrap">
        {error && <div className="error-banner">{error} <button onClick={() => setError(null)}>×</button></div>}
        {!proc && (
          <div style={{ padding: 32, color: "#6b7280" }}>
            No process selected. Click <strong>+ New</strong> to create one.
          </div>
        )}
        {proc && mode === "design" && (
          <BpmnModeler
            ref={modelerRef}
            initialXml={proc.bpmnXml}
            onSelection={onSelection}
            onChange={onModelChange}
            onElementRename={onElementRename}
          />
        )}
        {proc && mode === "run" && (
          <BpmnRunCanvas bpmnXml={proc.bpmnXml} activities={activities} />
        )}
      </div>

      <aside className="side">
        {mode === "design" ? (
          <TestConfigPanel
            selectedId={selected?.id ?? null}
            selectedType={selected?.type ?? null}
            selectedName={selected?.name ?? null}
            test={selectedTest}
            isServiceTask={isServiceTask}
            onChange={onTestChange}
          />
        ) : (
          <RunPanel activities={activities} active={active} />
        )}
      </aside>
    </div>
  );
}
