import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  BrowserForm,
  HttpForm,
  ScriptForm,
} from "../TestConfigPanel";
import {
  defaultTestFor,
  exportPlan,
  fetchPlan,
  fetchProcess,
  generateDataSet,
  importPlan,
  newPlanId,
  savePlan,
  startTestRun,
  type NodePlan,
  type PlanScenario,
  type PlanTestCase,
  type PlanTestSuite,
  type TestDef,
  type TestPlanFile,
  type TestStep,
  type TestDataSet,
} from "../api";

type Sel = {
  suiteId: string;
  scenarioId: string;
  caseId: string;
};

export default function AuthoringWorkspace() {
  const { key = "", nodeId = "" } = useParams();
  const navigate = useNavigate();
  const [procName, setProcName] = useState("");
  const [plan, setPlan] = useState<TestPlanFile | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [filter, setFilter] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState("default");
  const [scrollTop, setScrollTop] = useState(0);

  const load = useCallback(async () => {
    const p = await fetchProcess(key);
    setProcName(p.name);
    const pl = await fetchPlan(key);
    if (!pl.nodes[nodeId]) {
      pl.nodes[nodeId] = { nodeId, suites: [] };
    }
    setPlan(pl);
    const node = pl.nodes[nodeId];
    const suite = node.suites[0];
    const scenario = suite?.scenarios[0];
    const c = scenario?.cases[0];
    if (suite && scenario && c) {
      setSel({ suiteId: suite.id, scenarioId: scenario.id, caseId: c.id });
    }
  }, [key, nodeId]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const node = plan?.nodes[nodeId];

  const flatCases = useMemo(() => {
    if (!node) return [] as Array<{ suite: PlanTestSuite; scenario: PlanScenario; c: PlanTestCase }>;
    const out: Array<{ suite: PlanTestSuite; scenario: PlanScenario; c: PlanTestCase }> = [];
    for (const suite of node.suites) {
      for (const scenario of suite.scenarios) {
        for (const c of scenario.cases) {
          if (filter && !c.name.toLowerCase().includes(filter.toLowerCase())) continue;
          out.push({ suite, scenario, c });
        }
      }
    }
    return out;
  }, [node, filter]);

  const ROW_H = 32;
  const visible = flatCases.slice(scrollTop / ROW_H, scrollTop / ROW_H + 40);

  const selectedCase = useMemo(() => {
    if (!node || !sel) return null;
    const suite = node.suites.find((s) => s.id === sel.suiteId);
    const scenario = suite?.scenarios.find((s) => s.id === sel.scenarioId);
    return scenario?.cases.find((c) => c.id === sel.caseId) ?? null;
  }, [node, sel]);

  const persist = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await savePlan(key, plan);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updatePlan = (next: TestPlanFile) => {
    setPlan(next);
    setDirty(true);
  };

  const ensureDefaultHierarchy = () => {
    if (!plan || !node) return;
    if (node.suites.length > 0) return;
    const suiteId = newPlanId();
    const scenarioId = newPlanId();
    const caseId = newPlanId();
    node.suites.push({
      id: suiteId,
      name: "Default Suite",
      scenarios: [
        {
          id: scenarioId,
          name: "Default Scenario",
          cases: [
            {
              id: caseId,
              name: "Test Case 1",
              variables: {},
              steps: [],
              dataSets: [],
              executable: defaultTestFor("http.api", "Test Case 1"),
            },
          ],
        },
      ],
    });
    node.primaryCaseId = caseId;
    setSel({ suiteId, scenarioId, caseId });
    updatePlan({ ...plan });
  };

  const bulkAddCases = () => {
    const n = Number(prompt("How many test cases to add?", "10"));
    if (!n || n < 1) return;
    if (!plan || !node) return;
    ensureDefaultHierarchy();
    const suite = node.suites[0];
    const scenario = suite.scenarios[0];
    for (let i = 0; i < n; i++) {
      scenario.cases.push({
        id: newPlanId(),
        name: `Test Case ${scenario.cases.length + 1}`,
        variables: {},
        steps: [],
        dataSets: [],
      });
    }
    updatePlan({ ...plan });
  };

  const addCasesFromRows = useCallback(
    (rows: Record<string, unknown>[]) => {
      if (!plan || !node) return;
      if (node.suites.length === 0) {
        node.suites.push({
          id: newPlanId(),
          name: "Imported Suite",
          scenarios: [
            { id: newPlanId(), name: "Imported Scenario", cases: [] },
          ],
        });
      }
      const suite = node.suites[0];
      if (suite.scenarios.length === 0) {
        suite.scenarios.push({
          id: newPlanId(),
          name: "Imported Scenario",
          cases: [],
        });
      }
      const scenario = suite.scenarios[0];

      const pick = (raw: Record<string, unknown>, keys: string[]) => {
        for (const k of Object.keys(raw)) {
          if (keys.includes(k.trim().toLowerCase())) {
            return String(raw[k] ?? "").trim();
          }
        }
        return "";
      };

      let added = 0;
      let firstId: string | null = null;
      for (const raw of rows) {
        const name = pick(raw, ["name", "test case", "testcase", "title"]);
        if (!name) continue;
        const description = pick(raw, ["description", "desc", "summary"]);
        const typeRaw = pick(raw, ["type", "kind"]).toLowerCase();
        const url = pick(raw, ["url", "endpoint"]);
        const method = pick(raw, ["method", "verb"]);

        let executable: TestDef | undefined;
        if (/http|api|rest/.test(typeRaw)) {
          const http = defaultTestFor("http.api", name) as TestDef & {
            type: "http.api";
            request: { method: string; url: string };
          };
          if (url) http.request.url = url;
          if (method) http.request.method = method.toUpperCase();
          executable = http;
        } else if (/browser|ui|playwright|web/.test(typeRaw)) {
          executable = defaultTestFor("browser.playwright", name);
        } else if (/python|script|\bpy\b/.test(typeRaw)) {
          executable = defaultTestFor("script.python", name);
        }

        const existing = scenario.cases.find((c) => c.name === name);
        if (existing) {
          if (description) existing.description = description;
          if (executable) existing.executable = executable;
        } else {
          const id = newPlanId();
          if (!firstId) firstId = id;
          scenario.cases.push({
            id,
            name,
            description,
            variables: {},
            steps: [],
            dataSets: [],
            executable,
          });
          added++;
        }
      }

      if (added === 0) {
        setError(
          "No importable rows found. Ensure the sheet has a 'name' column.",
        );
        return;
      }
      setError(null);
      if (firstId) {
        setSel({ suiteId: suite.id, scenarioId: scenario.id, caseId: firstId });
      }
      updatePlan({ ...plan });
    },
    [plan, node],
  );

  const importExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
        });
        addCasesFromRows(rows);
      } catch (err) {
        setError(`Excel import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadExcelTemplate = () => {
    const rows = [
      {
        name: "Login succeeds with valid credentials",
        description: "Verify a known user can log in",
        type: "browser",
        url: "",
        method: "",
      },
      {
        name: "GET /health returns 200",
        description: "API smoke check",
        type: "http",
        url: "https://example.com/health",
        method: "GET",
      },
      {
        name: "Manual exploratory check",
        description: "No automation yet",
        type: "",
        url: "",
        method: "",
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TestCases");
    XLSX.writeFile(wb, "test-cases-template.xlsx");
  };

  const updateCase = (patch: Partial<PlanTestCase>) => {
    if (!plan || !node || !sel || !selectedCase) return;
    const suite = node.suites.find((s) => s.id === sel.suiteId);
    const scenario = suite?.scenarios.find((s) => s.id === sel.scenarioId);
    const idx = scenario?.cases.findIndex((c) => c.id === sel.caseId) ?? -1;
    if (!scenario || idx < 0) return;
    scenario.cases[idx] = { ...selectedCase, ...patch };
    updatePlan({ ...plan });
  };

  const runScope = async (type: "case" | "scenario" | "suite" | "node") => {
    if (!plan) return;
    if (dirty) await persist();
    const scope = {
      type,
      processKey: key,
      nodeId,
      suiteId: sel?.suiteId,
      scenarioId: sel?.scenarioId,
      caseId: sel?.caseId,
    };
    const res = await startTestRun({ scope: scope as never, environment: env });
    navigate(`/runs/${res.runId}`);
  };

  if (!plan || !node) {
    return <div className="workspace-loading">Loading authoring workspace…</div>;
  }

  return (
    <div className="authoring-workspace">
      <header className="workspace-header">
        <Link to={`/process/${key}`}>← Back to design</Link>
        <h2>{procName} · Node {nodeId}</h2>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search cases…" />
        <button type="button" onClick={ensureDefaultHierarchy}>+ Suite/Scenario</button>
        <button type="button" onClick={bulkAddCases}>Bulk add cases</button>
        <button type="button" onClick={persist} disabled={!dirty || saving}>{saving ? "Saving…" : "Save plan"}</button>
        <button type="button" onClick={() => runScope(sel ? "case" : "node")}>Generate run</button>
        <label>
          Env{" "}
          <input value={env} onChange={(e) => setEnv(e.target.value)} style={{ width: 100 }} />
        </label>
      </header>
      {error && <div className="error-banner">{error}</div>}

      <div className="workspace-body">
        <aside
          className="workspace-tree"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div style={{ height: flatCases.length * ROW_H, position: "relative" }}>
            {visible.map((_item, i) => {
              const idx = Math.floor(scrollTop / ROW_H) + i;
              const item = flatCases[idx];
              if (!item) return null;
              const active =
                sel?.caseId === item.c.id &&
                sel.suiteId === item.suite.id &&
                sel.scenarioId === item.scenario.id;
              return (
                <button
                  key={item.c.id}
                  type="button"
                  className={`tree-case ${active ? "tree-on" : ""}`}
                  style={{
                    position: "absolute",
                    top: idx * ROW_H,
                    left: 0,
                    right: 0,
                    height: ROW_H,
                  }}
                  onClick={() =>
                    setSel({
                      suiteId: item.suite.id,
                      scenarioId: item.scenario.id,
                      caseId: item.c.id,
                    })
                  }
                >
                  <span className="tree-suite">{item.suite.name}</span> / {item.scenario.name} / {item.c.name}
                </button>
              );
            })}
          </div>
        </aside>

        <main className="workspace-editor">
          {!selectedCase ? (
            <p>Select or create a test case.</p>
          ) : (
            <>
              <div className="field">
                <label>Case name</label>
                <input
                  value={selectedCase.name}
                  onChange={(e) => updateCase({ name: e.target.value })}
                />
              </div>
              <CaseVariablesEditor
                variables={selectedCase.variables ?? {}}
                onChange={(variables) => updateCase({ variables })}
              />
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={node.primaryCaseId === selectedCase.id}
                    onChange={(e) => {
                      node.primaryCaseId = e.target.checked ? selectedCase.id : undefined;
                      updatePlan({ ...plan });
                    }}
                  />{" "}
                  Primary executable for BPMN node
                </label>
              </div>
              <div className="seg">
                {(["http.api", "browser.playwright", "script.python"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={selectedCase.executable?.type === t ? "seg-on" : ""}
                    onClick={() =>
                      updateCase({
                        executable: defaultTestFor(t, selectedCase.name),
                      })
                    }
                  >
                    {t === "http.api" ? "HTTP" : t === "browser.playwright" ? "Browser" : "Python"}
                  </button>
                ))}
              </div>
              {selectedCase.executable?.type === "http.api" && (
                <HttpForm
                  test={selectedCase.executable}
                  onChange={(t) => updateCase({ executable: t as TestDef })}
                />
              )}
              {selectedCase.executable?.type === "browser.playwright" && (
                <BrowserForm
                  test={selectedCase.executable}
                  onChange={(t) => updateCase({ executable: t as TestDef })}
                />
              )}
              {selectedCase.executable?.type === "script.python" && (
                <ScriptForm
                  test={selectedCase.executable}
                  onChange={(t) => updateCase({ executable: t as TestDef })}
                />
              )}

              <h3>Test steps</h3>
              {selectedCase.steps.map((step, i) => (
                <div key={step.id} className="step-card">
                  <input
                    value={step.name}
                    onChange={(e) => {
                      const steps = [...selectedCase.steps];
                      steps[i] = { ...step, name: e.target.value };
                      updateCase({ steps });
                    }}
                  />
                  <input
                    value={step.action}
                    placeholder="action"
                    onChange={(e) => {
                      const steps = [...selectedCase.steps];
                      steps[i] = { ...step, action: e.target.value };
                      updateCase({ steps });
                    }}
                  />
                  <input
                    value={step.expectedResult ?? ""}
                    placeholder="expected result"
                    onChange={(e) => {
                      const steps = [...selectedCase.steps];
                      steps[i] = { ...step, expectedResult: e.target.value };
                      updateCase({ steps });
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  updateCase({
                    steps: [
                      ...selectedCase.steps,
                      { id: newPlanId(), name: "Step", action: "verify" },
                    ],
                  })
                }
              >
                + Step
              </button>

              <h3>Test data sets</h3>
              {(selectedCase.dataSets.length ? selectedCase.dataSets : []).map((ds, di) => (
                <DataSetEditor
                  key={ds.id}
                  dataSet={ds}
                  onChange={(next) => {
                    const dataSets = [...selectedCase.dataSets];
                    dataSets[di] = next;
                    updateCase({ dataSets });
                  }}
                  onGenerate={async () => {
                    const rows = await generateDataSet(key, nodeId, selectedCase.id, ds.id, 5);
                    const dataSets = [...selectedCase.dataSets];
                    dataSets[di] = { ...ds, rows };
                    updateCase({ dataSets });
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() =>
                  updateCase({
                    dataSets: [
                      ...selectedCase.dataSets,
                      {
                        id: newPlanId(),
                        name: "Data set",
                        rows: [{}],
                        fakerSchema: { email: "faker:email", name: "faker:name" },
                      },
                    ],
                  })
                }
              >
                + Data set
              </button>
            </>
          )}
        </main>
      </div>

      <footer className="workspace-footer">
        <button
          type="button"
          onClick={async () => {
            const data = await exportPlan(key);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${key}-plan.json`;
            a.click();
          }}
        >
          Export plan
        </button>
        <button
          type="button"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              const text = await file.text();
              const parsed = JSON.parse(text) as { plan: TestPlanFile };
              await importPlan(key, parsed.plan ?? (parsed as unknown as TestPlanFile));
              await load();
            };
            input.click();
          }}
        >
          Import plan
        </button>
        <span className="footer-sep" />
        <button
          type="button"
          className="primary"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept =
              ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
            input.onchange = () => {
              const file = input.files?.[0];
              if (file) importExcel(file);
            };
            input.click();
          }}
        >
          Import test cases (Excel)
        </button>
        <button type="button" onClick={downloadExcelTemplate}>
          Download Excel template
        </button>
      </footer>
    </div>
  );
}

function DataSetEditor({
  dataSet,
  onChange,
  onGenerate,
}: {
  dataSet: TestDataSet;
  onChange: (d: TestDataSet) => void;
  onGenerate: () => void;
}) {
  const [bulk, setBulk] = useState("");
  const applyBulk = () => {
    if (!bulk.trim()) return;
    try {
      const rows = JSON.parse(bulk) as Record<string, unknown>[];
      onChange({ ...dataSet, rows });
    } catch {
      alert("Invalid JSON");
    }
  };
  return (
    <div className="dataset-card">
      <input
        value={dataSet.name}
        onChange={(e) => onChange({ ...dataSet, name: e.target.value })}
      />
      <button type="button" onClick={onGenerate}>Generate (Faker)</button>
      <textarea
        rows={4}
        placeholder='Bulk paste JSON rows, e.g. [{"email":"a@b.com"}]'
        value={bulk}
        onChange={(e) => setBulk(e.target.value)}
        onBlur={applyBulk}
      />
      <button
        type="button"
        onClick={applyBulk}
      >
        Apply bulk rows
      </button>
      <pre className="script-output">{JSON.stringify(dataSet.rows, null, 2)}</pre>
    </div>
  );
}

function CaseVariablesEditor({
  variables,
  onChange,
}: {
  variables: Record<string, unknown>;
  onChange: (variables: Record<string, unknown>) => void;
}) {
  const text = JSON.stringify(variables, null, 2);

  const updateText = (next: string) => {
    if (!next.trim()) {
      onChange({});
      return;
    }
    try {
      const parsed = JSON.parse(next) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        onChange(parsed);
      }
    } catch {
      // Keep the draft visible while the user is still typing incomplete JSON.
    }
  };

  return (
    <div className="field">
      <label>Case memory variables</label>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => updateText(e.target.value)}
        placeholder='{"customerId": "C123", "region": "US"}'
      />
      <p className="hint">
        Saved with this test case and injected into executions. Use as{" "}
        <code>{"{{customerId}}"}</code> in HTTP/browser fields or read from{" "}
        <code>QA_VARS</code> in Python.
      </p>
    </div>
  );
}
