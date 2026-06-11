import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as XLSX from "xlsx";
import { HttpForm, ScriptForm } from "../TestConfigPanel";
import StepTextarea, { type VarOption } from "./StepTextarea";
import {
  EXECUTION_MODES,
  defaultTestFor,
  fetchPlan,
  fetchRun,
  isBrowserEvidence,
  isScriptEvidence,
  newPlanId,
  resolveAssetUrl,
  savePlan,
  startTestRun,
  type ActivityState,
  type CaseField,
  type CaseFieldType,
  type CaseParam,
  type ExecutionMode,
  type NodePlan,
  type PlanScenario,
  type PlanTestCase,
  type PlanTestSuite,
  type TestDef,
  type TestPlanFile,
  type TestStep,
} from "../api";

interface Props {
  processKey: string;
  nodeId: string;
  nodeName: string | null;
  predecessorIds: string[];
  onClose?: () => void;
  variant?: "drawer" | "panel";
}

type Selection = {
  suiteId: string;
  scenarioId: string;
  caseId?: string;
};

const SUITE_COLS = ["suite", "test suite", "suite name"];
const SCENARIO_COLS = ["scenario", "test scenario", "scenario name"];
const CASE_COLS = [
  "case",
  "test case",
  "testcase",
  "test case name",
  "tc",
  "tc name",
  "test case id",
  "name",
  "title",
];
const DESC_COLS = ["description", "desc", "summary", "objective", "precondition"];
const STEP_COLS = [
  "step",
  "steps",
  "test step",
  "test steps",
  "action",
  "actions",
  "instruction",
  "instructions",
  "step description",
  "step details",
  "test step description",
];
const EXPECTED_COLS = [
  "expected",
  "expected result",
  "expected results",
  "expectedresult",
  "expected outcome",
  "expected behavior",
  "expected behaviour",
  "result",
];

const KNOWN_COLS = [
  ...SUITE_COLS,
  ...SCENARIO_COLS,
  ...CASE_COLS,
  ...DESC_COLS,
  ...STEP_COLS,
  ...EXPECTED_COLS,
];

function pick(raw: Record<string, unknown>, keys: string[]): string {
  for (const k of Object.keys(raw)) {
    if (keys.includes(k.trim().toLowerCase())) {
      const v = String(raw[k] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

function inferType(value: string): CaseFieldType {
  if (/^\d+(\.\d+)?$/.test(value)) return "number";
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "email";
  if (/^https?:\/\//i.test(value)) return "url";
  if (/^(true|false)$/i.test(value)) return "boolean";
  return "text";
}

function rowToFields(raw: Record<string, unknown>): CaseField[] {
  const fields: CaseField[] = [];
  for (const k of Object.keys(raw)) {
    if (KNOWN_COLS.includes(k.trim().toLowerCase())) continue;
    const value = String(raw[k] ?? "").trim();
    if (!value) continue;
    fields.push({
      id: newPlanId(),
      name: k.trim(),
      type: inferType(value),
      value,
    });
  }
  return fields;
}

function rowToStep(raw: Record<string, unknown>): TestStep {
  const action = pick(raw, STEP_COLS);
  return {
    id: newPlanId(),
    name: action || "Step",
    action,
    expectedResult: pick(raw, EXPECTED_COLS),
    fields: rowToFields(raw),
  };
}

/** Build a test case from a group of sheet rows (one row per step, or per case). */
function makeCaseFromRows(
  name: string,
  rows: Record<string, unknown>[],
  mode: ExecutionMode,
): PlanTestCase {
  let steps = rows
    .filter((r) => pick(r, STEP_COLS) || pick(r, EXPECTED_COLS))
    .map(rowToStep);
  if (steps.length === 0) {
    steps = rows
      .map(rowToStep)
      .filter(
        (s) => s.action || s.expectedResult || (s.fields?.length ?? 0) > 0,
      );
  }
  return {
    id: newPlanId(),
    name,
    description: pick(rows[0] ?? {}, DESC_COLS),
    variables: {},
    steps,
    dataSets: [],
    executionMode: mode,
    inputs: [],
    outputs: [],
    fields: [],
  };
}

function readSheet(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(
          XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: "",
          }),
        );
      } catch (err) {
        reject(err as Error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function pickFile(onFile: (f: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept =
    ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";
  input.style.display = "none";
  document.body.appendChild(input);
  input.onchange = () => {
    const f = input.files?.[0];
    document.body.removeChild(input);
    if (f) onFile(f);
  };
  input.click();
}

function ExcelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="#1d6f42"
        d="M13.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5z"
      />
      <path fill="#0f4429" d="M13.5 2 20 8.5h-6.5z" />
      <path
        fill="#fff"
        d="m8.4 11.2 1.7 2.7-1.8 2.9h1.4l1.1-2 1.1 2h1.4l-1.8-2.9 1.7-2.7h-1.4l-1 1.8-1-1.8z"
      />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg viewBox="0 0 87.3 78" width="15" height="15" aria-hidden="true">
      <path
        fill="#0066da"
        d="M6.6 66.85 10.45 73.5c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z"
      />
      <path
        fill="#00ac47"
        d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.45C.4 49.85 0 51.4 0 52.95h27.5z"
      />
      <path
        fill="#ea4335"
        d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z"
      />
      <path
        fill="#00832d"
        d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.95 0H34.35c-1.55 0-3.1.45-4.45 1.2z"
      />
      <path
        fill="#2684fc"
        d="M59.8 52.95H27.5L13.75 76.75c1.35.8 2.9 1.2 4.45 1.2h50.8c1.55 0 3.1-.45 4.45-1.2z"
      />
      <path
        fill="#ffba00"
        d="M73.4 26.5 60.75 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 52.95h27.45c0-1.55-.4-3.1-1.2-4.5z"
      />
    </svg>
  );
}

export default function NodeTestDrawer({
  processKey,
  nodeId,
  nodeName,
  predecessorIds,
  onClose,
  variant = "drawer",
}: Props) {
  const [plan, setPlan] = useState<TestPlanFile | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(
    new Set(),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    { type: "suite" | "scenario" | "case"; id: string } | null
  >(null);

  const [runEnv, setRunEnv] = useState("staging");
  const [runId, setRunId] = useState<string | null>(null);
  const [runActivities, setRunActivities] = useState<ActivityState[]>([]);
  const [runActive, setRunActive] = useState(false);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const pl = await fetchPlan(processKey);
    if (!pl.nodes[nodeId]) {
      pl.nodes[nodeId] = { nodeId, suites: [] };
    }
    setPlan(pl);
    const node = pl.nodes[nodeId];
    const suite = node.suites[0];
    const scenario = suite?.scenarios[0];
    if (suite && scenario) {
      setSel({ suiteId: suite.id, scenarioId: scenario.id });
      setExpandedSuites(new Set([suite.id]));
      setExpandedScenarios(new Set([scenario.id]));
    }
  }, [processKey, nodeId]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const node: NodePlan | undefined = plan?.nodes[nodeId];

  const upstreamOutputs = useMemo(() => {
    if (!plan) return [] as Array<{ nodeId: string; name: string }>;
    const out: Array<{ nodeId: string; name: string }> = [];
    for (const pid of predecessorIds) {
      const pnode = plan.nodes[pid];
      if (!pnode) continue;
      for (const suite of pnode.suites) {
        for (const scenario of suite.scenarios) {
          for (const c of scenario.cases) {
            for (const o of c.outputs ?? []) {
              if (o.name.trim()) out.push({ nodeId: pid, name: o.name.trim() });
            }
          }
        }
      }
    }
    const seen = new Set<string>();
    return out.filter((o) => {
      const k = `${o.nodeId}.${o.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [plan, predecessorIds]);

  const update = (next: TestPlanFile) => {
    setPlan(next);
    setDirty(true);
  };

  const persist = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await savePlan(processKey, plan);
      setDirty(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const addSuite = () => {
    if (!plan || !node) return;
    const suiteId = newPlanId();
    const scenarioId = newPlanId();
    node.suites.push({
      id: suiteId,
      name: `Test Suite ${node.suites.length + 1}`,
      executionMode: "hitl",
      scenarios: [{ id: scenarioId, name: "Scenario 1", cases: [] }],
    });
    setExpandedSuites((s) => new Set(s).add(suiteId));
    setExpandedScenarios((s) => new Set(s).add(scenarioId));
    setSel({ suiteId, scenarioId });
    update({ ...plan });
  };

  const addScenario = (suite: PlanTestSuite) => {
    if (!plan) return;
    const scenarioId = newPlanId();
    suite.scenarios.push({
      id: scenarioId,
      name: `Scenario ${suite.scenarios.length + 1}`,
      cases: [],
    });
    setExpandedSuites((s) => new Set(s).add(suite.id));
    setExpandedScenarios((s) => new Set(s).add(scenarioId));
    setSel({ suiteId: suite.id, scenarioId });
    update({ ...plan });
  };

  const addCase = (suite: PlanTestSuite, scenario: PlanScenario) => {
    if (!plan) return;
    const caseId = newPlanId();
    scenario.cases.push({
      id: caseId,
      name: `Test Case ${scenario.cases.length + 1}`,
      description: "",
      variables: {},
      steps: [],
      dataSets: [],
      executionMode: "hitl",
      inputs: [{ id: newPlanId(), name: "", type: "text", source: "", value: "" }],
      outputs: [{ id: newPlanId(), name: "", type: "text", value: "" }],
      fields: [],
    });
    setExpandedSuites((s) => new Set(s).add(suite.id));
    setExpandedScenarios((s) => new Set(s).add(scenario.id));
    setSel({ suiteId: suite.id, scenarioId: scenario.id, caseId });
    update({ ...plan });
  };

  const activeScenario = useMemo(() => {
    if (!node || !sel) return null;
    const suite = node.suites.find((s) => s.id === sel.suiteId);
    const scenario = suite?.scenarios.find((s) => s.id === sel.scenarioId);
    if (!suite || !scenario) return null;
    return { suite, scenario };
  }, [node, sel]);

  const priorCaseVarsById = useMemo(() => {
    const map = new Map<string, VarOption[]>();
    if (!activeScenario) return map;
    const accumulated: VarOption[] = upstreamOutputs.map((o) => ({
      name: o.name,
      hint: `from upstream node ${o.nodeId}`,
    }));
    for (const c of activeScenario.scenario.cases) {
      map.set(c.id, [...accumulated]);
      for (const o of c.outputs ?? []) {
        const n = o.name.trim();
        if (n) accumulated.push({ name: n, hint: `from case "${c.name}"` });
      }
    }
    return map;
  }, [activeScenario, upstreamOutputs]);

  const renameSuite = (suite: PlanTestSuite, name: string) => {
    if (!plan) return;
    suite.name = name;
    update({ ...plan });
  };

  const renameScenario = (scenario: PlanScenario, name: string) => {
    if (!plan) return;
    scenario.name = name;
    update({ ...plan });
  };

  const removeSuite = (suite: PlanTestSuite) => {
    if (!plan || !node) return;
    if (
      !window.confirm(
        `Delete test suite "${suite.name}" and all its scenarios and cases?`,
      )
    )
      return;
    node.suites = node.suites.filter((s) => s.id !== suite.id);
    if (sel?.suiteId === suite.id) setSel(null);
    update({ ...plan });
  };

  const removeScenario = (suite: PlanTestSuite, scenario: PlanScenario) => {
    if (!plan) return;
    if (
      !window.confirm(
        `Delete scenario "${scenario.name}" and all its test cases?`,
      )
    )
      return;
    suite.scenarios = suite.scenarios.filter((s) => s.id !== scenario.id);
    if (sel?.scenarioId === scenario.id) setSel(null);
    update({ ...plan });
  };

  const mutateCase = (
    scenario: PlanScenario,
    caseId: string,
    patch: Partial<PlanTestCase>,
  ) => {
    if (!plan) return;
    const idx = scenario.cases.findIndex((c) => c.id === caseId);
    if (idx < 0) return;
    scenario.cases[idx] = { ...scenario.cases[idx], ...patch };
    update({ ...plan });
  };

  const removeCase = (scenario: PlanScenario, caseId: string) => {
    if (!plan) return;
    scenario.cases = scenario.cases.filter((c) => c.id !== caseId);
    update({ ...plan });
  };

  const setCaseMode = (
    scenario: PlanScenario,
    c: PlanTestCase,
    mode: ExecutionMode,
  ) => {
    const patch: Partial<PlanTestCase> = { executionMode: mode };
    if (mode === "executor" && c.executable?.type !== "script.python") {
      patch.executable = defaultTestFor("script.python", c.name);
    } else if (mode === "agent") {
      // Agent cases are generated from the plain-English steps at run time.
      // Don't seed a placeholder executable — it would block AI generation.
      patch.executable = undefined;
    }
    mutateCase(scenario, c.id, patch);
  };

  // ---- Sheet upload (Google Sheet export / Excel / CSV) ----
  const importScenarioSheet = (scenario: PlanScenario, mode: ExecutionMode) => {
    pickFile(async (file) => {
      try {
        const rows = await readSheet(file);
        if (rows.length === 0) {
          setError("That sheet has no data rows.");
          return;
        }
        const byCase = new Map<string, Record<string, unknown>[]>();
        let auto = 0;
        for (const raw of rows) {
          const caseName = pick(raw, CASE_COLS) || `Imported Case ${++auto}`;
          if (!byCase.has(caseName)) byCase.set(caseName, []);
          byCase.get(caseName)!.push(raw);
        }
        let added = 0;
        for (const [caseName, caseRows] of byCase) {
          scenario.cases.push(makeCaseFromRows(caseName, caseRows, mode));
          added++;
        }
        if (plan) update({ ...plan });
        setError(null);
        setInfo(
          added > 0
            ? `Imported ${added} test case${added === 1 ? "" : "s"} from ${file.name}.`
            : "No test cases found. Expected columns like Test Case, Test Step, Expected Result.",
        );
      } catch (e) {
        setError(`Sheet import failed: ${(e as Error).message}`);
      }
    });
  };

  const importCaseSheet = (scenario: PlanScenario, caseId: string) => {
    pickFile(async (file) => {
      try {
        const rows = await readSheet(file);
        const steps = rows
          .filter((r) => pick(r, STEP_COLS) || pick(r, EXPECTED_COLS) || rowToFields(r).length)
          .map(rowToStep);
        const idx = scenario.cases.findIndex((c) => c.id === caseId);
        if (idx >= 0 && plan) {
          const existing = scenario.cases[idx];
          scenario.cases[idx] = {
            ...existing,
            steps: [...existing.steps, ...steps],
          };
          update({ ...plan });
        }
        setError(null);
        setInfo(
          steps.length > 0
            ? `Imported ${steps.length} step${steps.length === 1 ? "" : "s"} into this case.`
            : "No steps found. Expected columns like Test Step / Expected Result.",
        );
      } catch (e) {
        setError(`Sheet import failed: ${(e as Error).message}`);
      }
    });
  };

  const importFromDrive = () => {
    setInfo(
      "Google Drive import will walk you through Google sign-in in the next iteration. For now, export the sheet (File → Download → CSV/Excel) and use the sheet upload.",
    );
  };

  // ---- Test execution + scenario-level screenshots ----
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetchRun(runId);
        if (cancelled) return;
        setRunActivities(r.activities);
        setRunActive(r.active);
        if (r.active) pollRef.current = window.setTimeout(tick, 1000);
      } catch {
        /* keep last state */
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [runId]);

  const runScenario = async () => {
    if (!plan || !activeScenario) return;
    setRunning(true);
    try {
      if (dirty) await persist();
      setRunActivities([]);
      const res = await startTestRun({
        scope: {
          type: "scenario",
          processKey,
          nodeId,
          suiteId: activeScenario.suite.id,
          scenarioId: activeScenario.scenario.id,
        },
        environment: runEnv,
      });
      setRunId(res.runId);
      setRunActive(true);
      setError(null);
    } catch (e) {
      setError(`Run failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const scenarioActivities = useMemo(() => {
    if (!activeScenario) return [] as ActivityState[];
    return runActivities.filter(
      (a) => a.traceability?.scenarioId === activeScenario.scenario.id,
    );
  }, [runActivities, activeScenario]);

  const scenarioShots = useMemo(() => {
    const shots: Array<{
      caseName?: string;
      stepName?: string;
      url: string;
      status: string;
    }> = [];
    for (const a of scenarioActivities) {
      if (isBrowserEvidence(a.evidence)) {
        for (const s of a.evidence.steps) {
          if (s.screenshotUrl) {
            shots.push({
              caseName: a.traceability?.caseName,
              stepName: s.name ?? s.action,
              url: resolveAssetUrl(s.screenshotUrl) ?? s.screenshotUrl,
              status: s.status,
            });
          }
        }
      }
    }
    return shots;
  }, [scenarioActivities]);

  const caseRunStatus = useMemo(() => {
    const map = new Map<string, "passed" | "failed" | "running">();
    for (const a of runActivities) {
      const cid = a.traceability?.caseId;
      if (!cid) continue;
      const prev = map.get(cid);
      if (a.status === "failed") map.set(cid, "failed");
      else if (a.status === "running") {
        if (prev !== "failed") map.set(cid, "running");
      } else if (a.status === "passed") {
        if (!prev) map.set(cid, "passed");
      }
    }
    return map;
  }, [runActivities]);

  const caseActivities = useMemo(() => {
    const map = new Map<string, ActivityState[]>();
    for (const a of runActivities) {
      const cid = a.traceability?.caseId;
      if (!cid) continue;
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid)!.push(a);
    }
    return map;
  }, [runActivities]);

  const runSummary = useMemo(() => {
    let passed = 0,
      failed = 0,
      runningN = 0;
    for (const a of scenarioActivities) {
      if (a.status === "passed") passed++;
      else if (a.status === "failed") failed++;
      else if (a.status === "running") runningN++;
    }
    return { passed, failed, running: runningN, total: scenarioActivities.length };
  }, [scenarioActivities]);

  const title = nodeName?.trim() || nodeId;

  return (
    <div
      className={variant === "drawer" ? "drawer-overlay" : "drawer-panel-shell"}
      onClick={variant === "drawer" ? onClose : undefined}
    >
      <div
        className={variant === "drawer" ? "drawer" : "drawer drawer-panel"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div className="drawer-title">
            <span className="drawer-eyebrow">Test authoring</span>
            <h2>{title}</h2>
          </div>
          <div className="drawer-head-actions">
            {dirty && <span className="dirty-badge">● unsaved</span>}
            {variant === "drawer" && (
              <button type="button" className="drawer-close" onClick={onClose}>
                ✕
              </button>
            )}
          </div>
        </header>

        {error && <div className="error-banner drawer-error">{error}</div>}
        {info && (
          <div className="info-banner drawer-error">
            {info} <button onClick={() => setInfo(null)}>×</button>
          </div>
        )}

        {!node ? (
          <div className="drawer-loading">Loading test plan…</div>
        ) : (
          <div className="drawer-body">
            {/* 30% — suites / scenarios / cases tree */}
            <aside className="drawer-tree">
              <div className="drawer-tree-head">
                <span>Test suites</span>
                <button type="button" onClick={addSuite}>
                  + Suite
                </button>
              </div>
              {node.suites.length === 0 && (
                <p className="drawer-tree-empty">
                  No test suites yet. Add one to begin authoring.
                </p>
              )}
              {node.suites.map((suite) => {
                const suiteOpen = expandedSuites.has(suite.id);
                return (
                  <div key={suite.id} className="tree-suite-group">
                    <TreeRow
                      kind="suite"
                      caret={suiteOpen ? "▾" : "▸"}
                      icon="▤"
                      name={suite.name}
                      editing={editing?.type === "suite" && editing.id === suite.id}
                      onActivate={() =>
                        setExpandedSuites((s) => toggle(s, suite.id))
                      }
                      onStartEdit={() =>
                        setEditing({ type: "suite", id: suite.id })
                      }
                      onRename={(name) => {
                        renameSuite(suite, name);
                        setEditing(null);
                      }}
                      onDelete={() => removeSuite(suite)}
                    />
                    {suiteOpen && (
                      <div className="tree-children">
                        {suite.scenarios.map((scenario) => {
                          const scOpen = expandedScenarios.has(scenario.id);
                          const scActive =
                            sel?.scenarioId === scenario.id && !sel?.caseId;
                          return (
                            <div key={scenario.id}>
                              <TreeRow
                                kind="scenario"
                                caret={scOpen ? "▾" : "▸"}
                                icon="❏"
                                name={scenario.name}
                                badge={
                                  <span className="tree-count">
                                    {scenario.cases.length}
                                  </span>
                                }
                                active={scActive}
                                editing={
                                  editing?.type === "scenario" &&
                                  editing.id === scenario.id
                                }
                                onActivate={() => {
                                  setExpandedScenarios((s) =>
                                    toggle(s, scenario.id),
                                  );
                                  setSel({
                                    suiteId: suite.id,
                                    scenarioId: scenario.id,
                                  });
                                }}
                                onStartEdit={() =>
                                  setEditing({
                                    type: "scenario",
                                    id: scenario.id,
                                  })
                                }
                                onRename={(name) => {
                                  renameScenario(scenario, name);
                                  setEditing(null);
                                }}
                                onDelete={() => removeScenario(suite, scenario)}
                              />
                              {scOpen && (
                                <div className="tree-children">
                                  {scenario.cases.map((c) => (
                                    <TreeRow
                                      key={c.id}
                                      kind="case"
                                      icon={
                                        c.executionMode === "executor"
                                          ? "❮❯"
                                          : c.executionMode === "agent"
                                            ? "✦"
                                            : "☑"
                                      }
                                      name={c.name}
                                      active={sel?.caseId === c.id}
                                      editing={
                                        editing?.type === "case" &&
                                        editing.id === c.id
                                      }
                                      onActivate={() =>
                                        setSel({
                                          suiteId: suite.id,
                                          scenarioId: scenario.id,
                                          caseId: c.id,
                                        })
                                      }
                                      onStartEdit={() =>
                                        setEditing({ type: "case", id: c.id })
                                      }
                                      onRename={(name) => {
                                        mutateCase(scenario, c.id, { name });
                                        setEditing(null);
                                      }}
                                      onDelete={() =>
                                        removeCase(scenario, c.id)
                                      }
                                    />
                                  ))}
                                  <button
                                    type="button"
                                    className="tree-add"
                                    onClick={() => addCase(suite, scenario)}
                                  >
                                    + Test case
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          className="tree-add"
                          onClick={() => addScenario(suite)}
                        >
                          + Scenario
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </aside>

            {/* 70% — suite/scenario controls, run, and test-case blocks */}
            <main className="drawer-cases">
              {!activeScenario ? (
                <div className="drawer-cases-empty">
                  Select a test scenario to view its test cases.
                </div>
              ) : (
                <>
                  <div className="cases-sticky-head">
                  {/* Breadcrumb — suite only (rename happens inline in the tree) */}
                  <div className="cases-crumb">
                    <span className="crumb-suite">
                      {activeScenario.suite.name}
                    </span>
                  </div>

                  <div className="cases-toolbar">
                    <button
                      type="button"
                      className="icon-btn icon-btn-excel"
                      title="Upload an Excel / CSV into this scenario"
                      aria-label="Upload Excel into scenario"
                      onClick={() =>
                        importScenarioSheet(activeScenario.scenario, "hitl")
                      }
                    >
                      <ExcelIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-drive"
                      title="Import from Google Drive"
                      aria-label="Import from Google Drive"
                      onClick={importFromDrive}
                    >
                      <DriveIcon />
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={persist}
                      disabled={!dirty || saving}
                    >
                      {saving ? "Saving…" : "Save Test Suite"}
                    </button>
                    <label className="run-env">
                      Env
                      <select
                        value={runEnv}
                        onChange={(e) => setRunEnv(e.target.value)}
                      >
                        <option value="local">local</option>
                        <option value="dev">dev</option>
                        <option value="qa">qa</option>
                        <option value="staging">staging</option>
                        <option value="production">production</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="primary"
                      onClick={runScenario}
                      disabled={running || runActive}
                    >
                      {running || runActive ? "Running…" : "▶ Run scenario"}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        addCase(activeScenario.suite, activeScenario.scenario)
                      }
                    >
                      + Test case
                    </button>
                  </div>
                  </div>

                  {/* Run status + scenario-level screenshots */}
                  {runId && (
                    <div className="run-bar">
                      <span className="run-status">
                        {runActive ? "in progress" : "done"} ·{" "}
                        <span className="pill pill-pass">
                          {runSummary.passed} passed
                        </span>{" "}
                        <span className="pill pill-fail">
                          {runSummary.failed} failed
                        </span>
                      </span>
                      <div className="run-shots">
                        <div className="run-shots-head">
                          Screenshots ({scenarioShots.length})
                        </div>
                        {scenarioShots.length === 0 ? (
                          <p className="param-empty">
                            {runActive
                              ? "Waiting for screenshots…"
                              : "No screenshots captured for this scenario."}
                          </p>
                        ) : (
                          <div className="shot-grid">
                            {scenarioShots.map((s, i) => (
                              <a
                                key={i}
                                className={`shot-card shot-${s.status}`}
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img src={s.url} alt={s.stepName ?? "screenshot"} />
                                <span className="shot-cap">
                                  {s.caseName ? `${s.caseName} · ` : ""}
                                  {s.stepName}
                                </span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeScenario.scenario.cases.length === 0 && (
                    <div className="drawer-cases-empty">
                      No test cases yet in this scenario.
                    </div>
                  )}

                  {activeScenario.scenario.cases.map((c) => (
                    <CaseBlock
                      key={c.id}
                      c={c}
                      highlight={sel?.caseId === c.id}
                      availableVars={priorCaseVarsById.get(c.id) ?? []}
                      onPatch={(patch) =>
                        mutateCase(activeScenario.scenario, c.id, patch)
                      }
                      onMode={(m) => setCaseMode(activeScenario.scenario, c, m)}
                      onRemove={() => removeCase(activeScenario.scenario, c.id)}
                      onUploadSheet={() =>
                        importCaseSheet(activeScenario.scenario, c.id)
                      }
                      onDrive={importFromDrive}
                      runStatus={caseRunStatus.get(c.id)}
                      activities={caseActivities.get(c.id) ?? []}
                    />
                  ))}
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeSelect({
  value,
  onChange,
}: {
  value: ExecutionMode;
  onChange: (m: ExecutionMode) => void;
}) {
  return (
    <div className="seg mode-seg">
      {EXECUTION_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          title={m.hint}
          className={value === m.value ? "seg-on" : ""}
          onClick={() => onChange(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function TreeRow({
  kind,
  caret,
  icon,
  name,
  badge,
  active,
  editing,
  onActivate,
  onStartEdit,
  onRename,
  onDelete,
}: {
  kind: "suite" | "scenario" | "case";
  caret?: string;
  icon: string;
  name: string;
  badge?: ReactNode;
  active?: boolean;
  editing: boolean;
  onActivate: () => void;
  onStartEdit: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (editing) setDraft(name);
  }, [editing, name]);

  return (
    <div
      className={`tree-row tree-row-${kind} ${active ? "tree-active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!editing) onActivate();
      }}
    >
      {caret ? <span className="tree-caret">{caret}</span> : null}
      <span className={`tree-icon tree-icon-${kind}`} aria-hidden>
        {icon}
      </span>
      {editing ? (
        <input
          className="tree-edit"
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onRename(draft.trim() || name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRename(draft.trim() || name);
            else if (e.key === "Escape") onRename(name);
          }}
        />
      ) : (
        <>
          <span className="tree-name">{name}</span>
          <button
            type="button"
            className="tree-pencil"
            title="Rename"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
          >
            ✎
          </button>
          <button
            type="button"
            className="tree-trash"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            🗑
          </button>
        </>
      )}
      {!editing && badge}
    </div>
  );
}

function CaseBlock({
  c,
  highlight,
  availableVars,
  onPatch,
  onMode,
  onRemove,
  onUploadSheet,
  onDrive,
  runStatus,
  activities,
}: {
  c: PlanTestCase;
  highlight: boolean;
  availableVars: VarOption[];
  onPatch: (patch: Partial<PlanTestCase>) => void;
  onMode: (m: ExecutionMode) => void;
  onRemove: () => void;
  onUploadSheet: () => void;
  onDrive: () => void;
  runStatus?: "passed" | "failed" | "running";
  activities: ActivityState[];
}) {
  const mode: ExecutionMode = c.executionMode ?? "hitl";
  const modeHint = EXECUTION_MODES.find((m) => m.value === mode)?.hint;
  const inputs = c.inputs ?? [];
  const outputs = c.outputs ?? [];
  const [showLog, setShowLog] = useState(false);
  const hasLog = activities.length > 0;
  const hasFailedLog = activities.some((a) => a.status === "failed");

  const newStep = (atIndex: number): TestStep => ({
    id: newPlanId(),
    name: `Step ${atIndex + 1}`,
    action: "",
    expectedResult: "",
    fields: [],
  });

  const insertStepAt = (index: number) => {
    const steps = [...c.steps];
    steps.splice(index, 0, newStep(index));
    onPatch({ steps });
  };

  return (
    <article className={`case-block ${highlight ? "case-block-active" : ""}`}>
      <div className="case-block-head">
        <input
          className="case-block-title"
          value={c.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        <span className={`mode-chip mode-${mode}`}>{mode.toUpperCase()}</span>
        <button
          type="button"
          className="icon-btn icon-btn-excel"
          title="Upload an Excel / CSV of steps into this case"
          aria-label="Upload Excel into case"
          onClick={onUploadSheet}
        >
          <ExcelIcon />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-drive"
          title="Import from Google Drive"
          aria-label="Import from Google Drive"
          onClick={onDrive}
        >
          <DriveIcon />
        </button>
        <button
          type="button"
          className="case-remove"
          title="Delete test case"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>

      <div className="case-mode-row">
        <ModeSelect value={mode} onChange={onMode} />
        <span className="case-mode-hint">{modeHint}</span>
      </div>

      {mode !== "executor" && (
        <textarea
          className="case-desc"
          rows={2}
          placeholder="Describe what this test verifies (layman language)…"
          value={c.description ?? ""}
          onChange={(e) => onPatch({ description: e.target.value })}
        />
      )}

      {/* Input / Output parameters */}
      <div className="param-grid">
        <div className="param-col">
          <div className="param-head">
            <span>Input parameters</span>
            <button
              type="button"
              onClick={() =>
                onPatch({
                  inputs: [
                    ...inputs,
                    { id: newPlanId(), name: "", type: "text", source: "", value: "" },
                  ],
                })
              }
            >
              + Input
            </button>
          </div>
          {inputs.length === 0 && <p className="param-empty">No inputs.</p>}
          {inputs.map((p, i) => (
            <ParamRow
              key={p.id}
              param={p}
              availableVars={availableVars}
              onChange={(next) => {
                const arr = [...inputs];
                arr[i] = next;
                onPatch({ inputs: arr });
              }}
              onRemove={() =>
                onPatch({ inputs: inputs.filter((x) => x.id !== p.id) })
              }
            />
          ))}
        </div>

        <div className="param-col">
          <div className="param-head">
            <span>Output parameters</span>
            <button
              type="button"
              onClick={() =>
                onPatch({
                  outputs: [
                    ...outputs,
                    { id: newPlanId(), name: "", type: "text", value: "" },
                  ],
                })
              }
            >
              + Output
            </button>
          </div>
          {outputs.length === 0 && <p className="param-empty">No outputs.</p>}
          {outputs.map((p, i) => (
            <ParamRow
              key={p.id}
              param={p}
              showSelector
              availableVars={availableVars}
              onChange={(next) => {
                const arr = [...outputs];
                arr[i] = next;
                onPatch({ outputs: arr });
              }}
              onRemove={() =>
                onPatch({ outputs: outputs.filter((x) => x.id !== p.id) })
              }
            />
          ))}
        </div>
      </div>

      {/* Test steps + expected results (hidden for executor — code block only) */}
      {mode !== "executor" && (
        <div className="case-steps">
          <div className="case-steps-head">
            <span>Test steps &amp; expected result</span>
            <button
              type="button"
              onClick={() => insertStepAt(c.steps.length)}
            >
              + Step
            </button>
          </div>
          {c.steps.length === 0 && (
            <p className="case-steps-empty">No steps yet.</p>
          )}
          {c.steps.map((step, i) => (
            <StepCard
              key={step.id}
              step={step}
              index={i}
              availableVars={availableVars}
              onChange={(next) => {
                const steps = [...c.steps];
                steps[i] = next;
                onPatch({ steps });
              }}
              onRemove={() =>
                onPatch({ steps: c.steps.filter((s) => s.id !== step.id) })
              }
              onAddBelow={() => insertStepAt(i + 1)}
            />
          ))}
          <button
            type="button"
            className="step-add-bottom"
            onClick={() => insertStepAt(c.steps.length)}
          >
            + Add step
          </button>
        </div>
      )}

      {/* Mode-driven notes / automation */}
      {mode === "hitl" && (
        <p className="mode-note mode-note-hitl">
          Human-in-the-loop — a person executes the steps above manually.
        </p>
      )}
      {mode === "agent" && (
        <p className="mode-note mode-note-agent">
          ✨ An AI agent converts these plain-English steps into a browser
          automation and runs them when you click Run scenario.
        </p>
      )}
      {mode === "executor" && (
        <div className="case-code">
          <div className="case-steps-head">
            <span>Code block</span>
          </div>
          {c.executable?.type === "script.python" ? (
            <ScriptForm
              test={c.executable}
              onChange={(t) => onPatch({ executable: t as TestDef })}
            />
          ) : c.executable?.type === "http.api" ? (
            <HttpForm
              test={c.executable}
              onChange={(t) => onPatch({ executable: t as TestDef })}
            />
          ) : (
            <button
              type="button"
              onClick={() =>
                onPatch({ executable: defaultTestFor("script.python", c.name) })
              }
            >
              + Add code block
            </button>
          )}
        </div>
      )}

      {/* Result — recorded at the bottom, after all steps execute */}
      <div className="result-row">
        <ResultControl
          mode={mode}
          manualResult={c.manualResult}
          runStatus={runStatus}
          onSet={(r) => onPatch({ manualResult: r })}
        />
        {hasLog && (
          <button
            type="button"
            className={`log-toggle ${showLog ? "log-toggle-on" : ""} ${hasFailedLog ? "log-toggle-failed" : ""}`}
            onClick={() => setShowLog((v) => !v)}
            title="View run log for this test case"
          >
            Log
            {hasFailedLog && <span className="log-fail-dot" aria-hidden />}
          </button>
        )}
      </div>
      {showLog && hasLog && <CaseLog activities={activities} />}
    </article>
  );
}

function StepCard({
  step,
  index,
  availableVars,
  onChange,
  onRemove,
  onAddBelow,
}: {
  step: TestStep;
  index: number;
  availableVars: VarOption[];
  onChange: (s: TestStep) => void;
  onRemove: () => void;
  onAddBelow?: () => void;
}) {
  const fields = step.fields ?? [];
  return (
    <div className="step-block">
      <div className="step-io">
        <div className="step-io-col">
          <label className="step-label">
            <span className="case-step-num">{index + 1}</span>
            Test step
          </label>
          <StepTextarea
            value={step.action}
            placeholder="Describe the test step… Type / for Playwright commands, @ for variables"
            availableVars={availableVars}
            enableSlash
            enableAt
            onChange={(action) =>
              onChange({ ...step, action, name: action || step.name })
            }
          />
        </div>
        <div className="step-io-col">
          <label className="step-label">Expected result</label>
          <StepTextarea
            value={step.expectedResult ?? ""}
            placeholder="Describe the expected result…"
            availableVars={availableVars}
            enableSlash={false}
            enableAt
            onChange={(expectedResult) =>
              onChange({ ...step, expectedResult })
            }
          />
        </div>
        <button
          type="button"
          className="case-step-del step-del-corner"
          title="Delete step"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
      <div className="step-data">
        <div className="param-head">
          <span>Test data (this step)</span>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...step,
                fields: [
                  ...fields,
                  {
                    id: newPlanId(),
                    name: `field_${fields.length + 1}`,
                    type: "text",
                    value: "",
                  },
                ],
              })
            }
          >
            + Field
          </button>
        </div>
        {fields.length === 0 && (
          <p className="param-empty">No test data for this step.</p>
        )}
        {fields.map((f, i) => (
          <FieldRow
            key={f.id}
            field={f}
            availableVars={availableVars}
            onChange={(next) => {
              const arr = [...fields];
              arr[i] = next;
              onChange({ ...step, fields: arr });
            }}
            onRemove={() =>
              onChange({ ...step, fields: fields.filter((x) => x.id !== f.id) })
            }
          />
        ))}
      </div>
      {onAddBelow && (
        <button type="button" className="step-add-inline" onClick={onAddBelow}>
          + Add step below
        </button>
      )}
    </div>
  );
}

function ParamRow({
  param,
  showSelector,
  availableVars = [],
  onChange,
  onRemove,
}: {
  param: CaseParam;
  showSelector?: boolean;
  availableVars?: VarOption[];
  onChange: (p: CaseParam) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`param-row ${showSelector ? "param-row-output" : ""}`}>
      <input
        className="param-name"
        placeholder="name"
        value={param.name}
        onChange={(e) => onChange({ ...param, name: e.target.value })}
      />
      {showSelector && (
        <input
          className="param-selector"
          placeholder="selector (for live extract)"
          title="CSS selector used by extractText at runtime"
          value={param.source ?? ""}
          onChange={(e) => onChange({ ...param, source: e.target.value })}
        />
      )}
      <div className="param-value-wrap">
        <StepTextarea
          className="param-value-input"
          rows={1}
          placeholder="value"
          availableVars={availableVars}
          enableSlash={false}
          enableAt
          value={param.value ?? ""}
          onChange={(value) => onChange({ ...param, value })}
        />
      </div>
      <button type="button" className="case-step-del" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

function formatActivityLogText(a: ActivityState): string {
  const lines: string[] = [];
  const row =
    a.traceability?.rowIndex !== undefined
      ? ` row ${a.traceability.rowIndex}`
      : "";
  lines.push(
    `[${a.status.toUpperCase()}]${row} ${a.durationInMillis ?? "?"}ms`,
  );
  if (a.message) lines.push(`Message: ${a.message}`);

  const ev = a.evidence;
  if (isBrowserEvidence(ev)) {
    lines.push(`Browser run (${ev.durationMs}ms):`);
    for (const s of ev.steps) {
      const label = s.name ? `${s.action} (${s.name})` : s.action;
      lines.push(
        `  #${s.index + 1} ${label} — ${s.status} (${s.durationMs}ms)`,
      );
      if (s.message) lines.push(`    ${s.message}`);
      if (s.extractedValue !== undefined)
        lines.push(`    extracted: ${s.extractedValue}`);
      if (s.screenshotUrl) lines.push(`    screenshot: ${s.screenshotUrl}`);
    }
  } else if (isScriptEvidence(ev)) {
    lines.push(`Script exit code: ${ev.exitCode ?? "null"}`);
    if (ev.stdout) lines.push(`stdout:\n${ev.stdout}`);
    if (ev.stderr) lines.push(`stderr:\n${ev.stderr}`);
    if (ev.logUrl) lines.push(`log: ${ev.logUrl}`);
  } else if (ev && typeof ev === "object" && (ev as { type?: string }).type === "http") {
    const http = ev as {
      request?: { method?: string; url?: string; body?: unknown };
      response?: { status?: number; bodyPreview?: string };
      durationMs?: number;
    };
    if (http.request) {
      lines.push(
        `HTTP ${http.request.method ?? "?"} ${http.request.url ?? ""}`,
      );
      if (http.request.body !== undefined)
        lines.push(`Request body: ${JSON.stringify(http.request.body)}`);
    }
    if (http.response) {
      lines.push(`Response: ${http.response.status ?? "?"}`);
      if (http.response.bodyPreview)
        lines.push(`Body: ${http.response.bodyPreview}`);
    }
    if (http.durationMs !== undefined)
      lines.push(`Duration: ${http.durationMs}ms`);
  } else if (ev) {
    lines.push(JSON.stringify(ev, null, 2));
  }
  return lines.join("\n");
}

function CaseLog({ activities }: { activities: ActivityState[] }) {
  const [copied, setCopied] = useState(false);

  const copyLog = async () => {
    const text = activities.map(formatActivityLogText).join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="case-log">
      <div className="case-log-head">
        <span className="case-log-title">Run log</span>
        <button type="button" className="case-log-copy" onClick={copyLog}>
          {copied ? "Copied" : "Copy log"}
        </button>
      </div>
      {activities.map((a) => (
        <div key={a.activityId} className="case-log-entry">
          <div className="case-log-entry-head">
            {a.traceability?.rowIndex !== undefined && (
              <span className="case-log-row">Row {a.traceability.rowIndex}</span>
            )}
            <span className={`pill pill-${a.status === "passed" ? "pass" : a.status === "failed" ? "fail" : "neutral"}`}>
              {a.status}
            </span>
            {a.durationInMillis != null && (
              <span className="case-log-dur">{a.durationInMillis}ms</span>
            )}
          </div>
          {a.message && (
            <div className={`case-log-message ${a.status === "failed" ? "case-log-message-fail" : ""}`}>
              {a.message}
            </div>
          )}
          {isBrowserEvidence(a.evidence) && (
            <div className="case-log-steps">
              {a.evidence.steps.map((s, i) => (
                <div
                  key={`${s.index}-${i}`}
                  className={`case-log-step case-log-step-${s.status}`}
                >
                  <div className="case-log-step-head">
                    <span className="case-log-step-num">#{s.index + 1}</span>
                    <span className="case-log-step-action">
                      {s.action}
                      {s.name ? ` (${s.name})` : ""}
                    </span>
                    <span className={`case-log-step-status case-log-step-status-${s.status}`}>
                      {s.status}
                    </span>
                    <span className="case-log-step-dur">{s.durationMs}ms</span>
                  </div>
                  {s.message && (
                    <pre className="case-log-step-msg">{s.message}</pre>
                  )}
                  {s.extractedValue !== undefined && (
                    <div className="case-log-extracted">
                      extracted: <code>{s.extractedValue}</code>
                    </div>
                  )}
                  {s.screenshotUrl && (
                    <a
                      className="case-log-shot"
                      href={resolveAssetUrl(s.screenshotUrl) ?? s.screenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={resolveAssetUrl(s.screenshotUrl) ?? s.screenshotUrl}
                        alt={`Step ${s.index + 1} screenshot`}
                      />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {isScriptEvidence(a.evidence) && (
            <div className="case-log-script">
              <div className="case-log-script-meta">
                exit code: {a.evidence.exitCode ?? "null"}
                {a.evidence.logUrl && (
                  <>
                    {" · "}
                    <a
                      href={resolveAssetUrl(a.evidence.logUrl) ?? a.evidence.logUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      full log
                    </a>
                  </>
                )}
              </div>
              {a.evidence.stdout && (
                <>
                  <div className="case-log-pre-label">stdout</div>
                  <pre className="case-log-pre">{a.evidence.stdout}</pre>
                </>
              )}
              {a.evidence.stderr && (
                <>
                  <div className="case-log-pre-label">stderr</div>
                  <pre className="case-log-pre case-log-pre-err">{a.evidence.stderr}</pre>
                </>
              )}
            </div>
          )}
          {a.evidence &&
            !isBrowserEvidence(a.evidence) &&
            !isScriptEvidence(a.evidence) &&
            typeof a.evidence === "object" &&
            (a.evidence as { type?: string }).type === "http" && (
              <div className="case-log-http">
                {(() => {
                  const http = a.evidence as {
                    request?: { method?: string; url?: string; body?: unknown };
                    response?: { status?: number; bodyPreview?: string };
                    durationMs?: number;
                  };
                  return (
                    <>
                      {http.request && (
                        <div className="case-log-http-req">
                          <span className="case-log-pre-label">Request</span>
                          <pre className="case-log-pre">
                            {http.request.method ?? "?"} {http.request.url ?? ""}
                            {http.request.body !== undefined
                              ? `\n${JSON.stringify(http.request.body, null, 2)}`
                              : ""}
                          </pre>
                        </div>
                      )}
                      {http.response && (
                        <div className="case-log-http-res">
                          <span className="case-log-pre-label">
                            Response ({http.response.status ?? "?"})
                          </span>
                          <pre className="case-log-pre">
                            {http.response.bodyPreview ?? "(empty)"}
                          </pre>
                        </div>
                      )}
                      {http.durationMs !== undefined && (
                        <div className="case-log-dur">Duration: {http.durationMs}ms</div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          {a.evidence &&
            !isBrowserEvidence(a.evidence) &&
            !isScriptEvidence(a.evidence) &&
            (a.evidence as { type?: string }).type !== "http" && (
              <pre className="case-log-pre">
                {JSON.stringify(a.evidence, null, 2)}
              </pre>
            )}
        </div>
      ))}
    </div>
  );
}

function ResultControl({
  mode,
  manualResult,
  runStatus,
  onSet,
}: {
  mode: ExecutionMode;
  manualResult?: "pass" | "fail" | "skip";
  runStatus?: "passed" | "failed" | "running";
  onSet: (r?: "pass" | "fail" | "skip") => void;
}) {
  const isHuman = mode === "hitl";
  const autoResult =
    runStatus === "passed" ? "pass" : runStatus === "failed" ? "fail" : undefined;
  const effective = isHuman ? manualResult : autoResult;
  const options: Array<"pass" | "fail" | "skip"> = ["pass", "fail", "skip"];

  return (
    <div className="result-control">
      <span className="result-label">Result</span>
      {options.map((r) => (
        <button
          key={r}
          type="button"
          className={`result-btn result-${r} ${
            effective === r ? "result-on" : ""
          }`}
          disabled={!isHuman}
          onClick={
            isHuman
              ? () => onSet(manualResult === r ? undefined : r)
              : undefined
          }
        >
          {r === "pass" ? "Pass" : r === "fail" ? "Fail" : "Skip"}
        </button>
      ))}
      <span className="result-meta">
        {isHuman
          ? "set by tester (HITL)"
          : runStatus === "running"
            ? `running — set by ${mode}`
            : autoResult
              ? `set by ${mode}`
              : `pending — set by ${mode} on run`}
      </span>
    </div>
  );
}

function FieldRow({
  field,
  availableVars = [],
  onChange,
  onRemove,
}: {
  field: CaseField;
  availableVars?: VarOption[];
  onChange: (f: CaseField) => void;
  onRemove: () => void;
}) {
  return (
    <div className="field-row">
      <input
        className="field-name"
        placeholder="name"
        value={field.name}
        onChange={(e) => onChange({ ...field, name: e.target.value })}
      />
      <div className="field-value-wrap">
        <StepTextarea
          className="field-value-input"
          rows={1}
          placeholder="value"
          availableVars={availableVars}
          enableSlash={false}
          enableAt
          value={field.value}
          onChange={(value) => onChange({ ...field, value })}
        />
      </div>
      <button type="button" className="case-step-del" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}
