import { useEffect, useMemo, useState } from "react";
import type {
  BrowserAction,
  BrowserStep,
  BrowserTestDef,
  HttpTestDef,
  ScriptTestDef,
  TestDef,
  TestType,
} from "./api";
import { defaultTestFor } from "./api";

interface Props {
  selectedId: string | null;
  selectedType: string | null;
  selectedName: string | null;
  test: TestDef | undefined;
  isServiceTask: boolean;
  onChange: (test: TestDef | null) => void;
}

const BROWSER_ACTIONS: { value: BrowserAction; label: string }[] = [
  { value: "goto", label: "Go to URL" },
  { value: "click", label: "Click" },
  { value: "tryClick", label: "Try click (optional)" },
  { value: "fill", label: "Fill input" },
  { value: "press", label: "Press key" },
  { value: "waitForSelector", label: "Wait for selector" },
  { value: "waitForLoadState", label: "Wait for load state" },
  { value: "waitForTimeout", label: "Wait (ms)" },
  { value: "screenshot", label: "Take screenshot" },
  { value: "assertContains", label: "Assert text contains" },
  { value: "assertVisible", label: "Assert element visible" },
];

export default function TestConfigPanel({
  selectedId,
  selectedType,
  selectedName,
  test,
  isServiceTask,
  onChange,
}: Props) {
  if (!selectedId) {
    return (
      <div className="config-empty">
        <h3>No element selected</h3>
        <p>Click an element on the canvas to inspect or configure it.</p>
        <p style={{ marginTop: 16, fontSize: 12, color: "#6b7280" }}>
          Drag a <strong>Task</strong> from the left palette onto the canvas, then
          double-click it to rename. Wire it up with sequence flows. Configure
          this side panel to define what the task should test.
        </p>
      </div>
    );
  }

  if (!isServiceTask) {
    return (
      <div className="config-empty">
        <h3>{selectedName || selectedId}</h3>
        <p className="config-type">{niceType(selectedType)}</p>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 14 }}>
          Only <strong>tasks</strong> can have a test attached. Select a task to
          configure its test. (For gateway routing, use sequence-flow
          conditions like <code>${"{environment.variables.your_var}"}</code>.)
        </p>
      </div>
    );
  }

  return (
    <div className="config">
      <div className="config-head">
        <h3>{selectedName || selectedId}</h3>
        <p className="config-type">{niceType(selectedType)} · id: <code>{selectedId}</code></p>
      </div>

      <div className="field">
        <label>Test attached</label>
        <div className="seg">
          <button
            className={!test ? "seg-on" : ""}
            onClick={() => onChange(null)}
            type="button"
          >
            None
          </button>
          <button
            className={test?.type === "http.api" ? "seg-on" : ""}
            onClick={() => onChange(defaultTestFor("http.api", selectedName ?? selectedId))}
            type="button"
          >
            HTTP
          </button>
          <button
            className={test?.type === "browser.playwright" ? "seg-on" : ""}
            onClick={() => onChange(defaultTestFor("browser.playwright", selectedName ?? selectedId))}
            type="button"
          >
            Browser
          </button>
          <button
            className={test?.type === "script.python" ? "seg-on" : ""}
            onClick={() => onChange(defaultTestFor("script.python", selectedName ?? selectedId))}
            type="button"
          >
            Python
          </button>
        </div>
        <p className="hint">
          The test runs when the engine reaches this task. Its pass/fail can be
          exposed as a variable for downstream gateways.
        </p>
      </div>

      {test?.type === "http.api" && (
        <HttpForm test={test} onChange={onChange} />
      )}
      {test?.type === "browser.playwright" && (
        <BrowserForm test={test} onChange={onChange} />
      )}
      {test?.type === "script.python" && (
        <ScriptForm test={test} onChange={onChange} />
      )}
      {test && test.type !== "script.python" && (
        <SetVariablesEditor
          value={test.setVariables ?? {}}
          onChange={(sv) => onChange({ ...test, setVariables: Object.keys(sv).length ? sv : undefined })}
        />
      )}
    </div>
  );
}

export function ScriptForm({
  test,
  onChange,
}: {
  test: ScriptTestDef;
  onChange: (t: TestDef) => void;
}) {
  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = test.code.slice(0, start);
    const after = test.code.slice(end);
    const indent = "    ";
    const next = before + indent + after;
    onChange({ ...test, code: next });
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + indent.length;
    });
  };
  return (
    <>
      <div className="field">
        <label>Test name</label>
        <input
          value={test.name}
          onChange={(e) => onChange({ ...test, name: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Python code</label>
        <textarea
          className="code-editor"
          rows={22}
          spellCheck={false}
          value={test.code}
          onChange={(e) => onChange({ ...test, code: e.target.value })}
          onKeyDown={handleTab}
        />
        <p className="hint">
          Exit code 0 = pass. Read engine vars from <code>os.environ["QA_VARS"]</code>{" "}
          (JSON). To return variables / message / evidence, print a line starting with
          <code> ##QA_RESULT##</code> followed by JSON.
        </p>
      </div>
      <div className="row-fields">
        <div className="field" style={{ flex: "0 0 160px" }}>
          <label>Timeout (ms)</label>
          <input
            type="number"
            min={1000}
            max={600000}
            value={test.timeoutMs ?? 30000}
            onChange={(e) =>
              onChange({
                ...test,
                timeoutMs: e.target.value ? Number(e.target.value) : 30000,
              })
            }
          />
        </div>
      </div>
      <div className="field">
        <h4>Environment variables</h4>
        <KvEditor
          label=""
          placeholderK="NAME (e.g. RECORDING_PY_REPLAY)"
          placeholderV="value (e.g. 1)"
          value={test.env ?? {}}
          onChange={(env) =>
            onChange({
              ...test,
              env: Object.keys(env).length ? env : undefined,
            })
          }
        />
        <p className="hint">
          Passed to the script process as real env vars. Use for flags like{" "}
          <code>RECORDING_PY_REPLAY=1</code> or credentials like{" "}
          <code>EXPLORER_USERNAME</code>. (For real secrets, prefer the host's
          secret store over committing them here.)
        </p>
      </div>
    </>
  );
}

export function HttpForm({
  test,
  onChange,
}: {
  test: HttpTestDef;
  onChange: (t: TestDef) => void;
}) {
  const update = (patch: Partial<HttpTestDef>) =>
    onChange({ ...test, ...patch } as HttpTestDef);
  const updateReq = (patch: Partial<HttpTestDef["request"]>) =>
    onChange({ ...test, request: { ...test.request, ...patch } });
  const updateExpect = (patch: Partial<HttpTestDef["expect"]>) =>
    onChange({ ...test, expect: { ...test.expect, ...patch } });

  const bodyText = useMemo(() => {
    if (test.request.body === undefined) return "";
    return typeof test.request.body === "string"
      ? test.request.body
      : JSON.stringify(test.request.body, null, 2);
  }, [test.request.body]);

  return (
    <>
      <div className="field">
        <label>Test name</label>
        <input
          value={test.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>

      <div className="row-fields">
        <div className="field" style={{ flex: "0 0 110px" }}>
          <label>Method</label>
          <select
            value={test.request.method}
            onChange={(e) => updateReq({ method: e.target.value })}
          >
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>URL</label>
          <input
            value={test.request.url}
            onChange={(e) => updateReq({ url: e.target.value })}
            placeholder="https://api.example.com/orders   or   {{BASE_URL}}/mock/orders"
          />
        </div>
      </div>

      <HeadersEditor
        value={test.request.headers ?? {}}
        onChange={(h) =>
          updateReq({ headers: Object.keys(h).length ? h : undefined })
        }
      />

      <div className="field">
        <label>Body (JSON or text)</label>
        <textarea
          rows={6}
          value={bodyText}
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw.trim()) {
              updateReq({ body: undefined });
              return;
            }
            try {
              updateReq({ body: JSON.parse(raw) });
            } catch {
              updateReq({ body: raw });
            }
          }}
          placeholder='{"orderId": 42}'
        />
      </div>

      <h4>Assertions</h4>
      <div className="row-fields">
        <div className="field" style={{ flex: "0 0 130px" }}>
          <label>Status code</label>
          <input
            type="number"
            value={test.expect.status ?? ""}
            onChange={(e) =>
              updateExpect({
                status: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </div>
      </div>
      <JsonPathEditor
        value={test.expect.jsonPath ?? {}}
        onChange={(jp) =>
          updateExpect({
            jsonPath: Object.keys(jp).length ? jp : undefined,
          })
        }
      />
    </>
  );
}

export function BrowserForm({
  test,
  onChange,
}: {
  test: BrowserTestDef;
  onChange: (t: TestDef) => void;
}) {
  const updateStep = (i: number, patch: Partial<BrowserStep>) => {
    const steps = test.steps.map((s, j) => (i === j ? { ...s, ...patch } : s));
    onChange({ ...test, steps });
  };
  const addStep = () =>
    onChange({ ...test, steps: [...test.steps, { action: "goto", url: "" }] });
  const removeStep = (i: number) =>
    onChange({ ...test, steps: test.steps.filter((_, j) => j !== i) });
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= test.steps.length) return;
    const steps = test.steps.slice();
    [steps[i], steps[j]] = [steps[j], steps[i]];
    onChange({ ...test, steps });
  };

  return (
    <>
      <div className="field">
        <label>Test name</label>
        <input
          value={test.name}
          onChange={(e) => onChange({ ...test, name: e.target.value })}
        />
      </div>

      <h4>Steps</h4>
      {test.steps.length === 0 && (
        <div className="hint">No steps yet. Add one below.</div>
      )}
      {test.steps.map((step, i) => (
        <BrowserStepEditor
          key={i}
          step={step}
          index={i}
          isLast={i === test.steps.length - 1}
          onChange={(patch) => updateStep(i, patch)}
          onRemove={() => removeStep(i)}
          onMove={(dir) => moveStep(i, dir)}
        />
      ))}
      <button className="ghost" onClick={addStep} type="button">
        + Add step
      </button>
    </>
  );
}

function BrowserStepEditor({
  step,
  index,
  isLast,
  onChange,
  onRemove,
  onMove,
}: {
  step: BrowserStep;
  index: number;
  isLast: boolean;
  onChange: (patch: Partial<BrowserStep>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="step-card">
      <div className="step-card-head">
        <span className="step-num">#{index + 1}</span>
        <select
          value={step.action}
          onChange={(e) =>
            onChange({ action: e.target.value as BrowserAction })
          }
        >
          {BROWSER_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <div className="step-card-actions">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}>↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={isLast}>↓</button>
          <button type="button" className="danger-text" onClick={onRemove}>×</button>
        </div>
      </div>
      <div className="step-fields">
        {(step.action === "goto") && (
          <Labeled label="URL"><input value={step.url ?? ""} onChange={(e) => onChange({ url: e.target.value })} /></Labeled>
        )}
        {(step.action === "click" ||
          step.action === "tryClick" ||
          step.action === "fill" ||
          step.action === "press" ||
          step.action === "waitForSelector" ||
          step.action === "assertVisible") && (
          <Labeled label="Selector"><input value={step.selector ?? ""} onChange={(e) => onChange({ selector: e.target.value })} placeholder='input[name="q"]' /></Labeled>
        )}
        {(step.action === "fill") && (
          <Labeled label="Value"><input value={step.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} /></Labeled>
        )}
        {(step.action === "press") && (
          <Labeled label="Key"><input value={step.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} placeholder="Enter" /></Labeled>
        )}
        {(step.action === "waitForLoadState") && (
          <Labeled label="State">
            <select value={step.state ?? "networkidle"} onChange={(e) => onChange({ state: e.target.value as "load" | "domcontentloaded" | "networkidle" })}>
              <option>load</option><option>domcontentloaded</option><option>networkidle</option>
            </select>
          </Labeled>
        )}
        {(step.action === "assertContains") && (
          <>
            <Labeled label="Text"><input value={step.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} /></Labeled>
            <label className="check">
              <input type="checkbox" checked={!!step.ignoreCase} onChange={(e) => onChange({ ignoreCase: e.target.checked })} />
              case-insensitive
            </label>
          </>
        )}
        {(step.action === "tryClick") && (
          <label className="check">
            <input type="checkbox" checked={step.optional ?? true} onChange={(e) => onChange({ optional: e.target.checked })} />
            optional (don't fail the test if missing)
          </label>
        )}
        <Labeled label="Label (optional)"><input value={step.name ?? ""} onChange={(e) => onChange({ name: e.target.value || undefined })} placeholder="e.g. after-search" /></Labeled>
        <Labeled label="Timeout (ms)">
          <input
            type="number"
            value={step.timeoutMs ?? ""}
            onChange={(e) =>
              onChange({
                timeoutMs: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            placeholder={step.action === "waitForTimeout" ? "1000" : "20000"}
          />
        </Labeled>
      </div>
    </div>
  );
}

function HeadersEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <KvEditor label="Headers" placeholderK="Header" placeholderV="Value" value={value} onChange={onChange} />
  );
}

function JsonPathEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const stringMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) out[k] = JSON.stringify(v);
    return out;
  }, [value]);
  return (
    <KvEditor
      label="jsonPath assertions"
      placeholderK="$.orderId"
      placeholderV="42"
      value={stringMap}
      onChange={(m) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(m)) {
          if (!v.trim()) continue;
          try {
            out[k] = JSON.parse(v);
          } catch {
            out[k] = v;
          }
        }
        onChange(out);
      }}
    />
  );
}

function SetVariablesEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <div className="field">
      <h4>Set engine variables</h4>
      <KvEditor
        label=""
        placeholderK="variable name (e.g. verify_order_passed)"
        placeholderV="expect.passed"
        value={value}
        onChange={onChange}
      />
      <p className="hint">
        Source can be <code>expect.passed</code> (boolean). Use these in gateway
        conditions like <code>${"{environment.variables.verify_order_passed}"}</code>.
      </p>
    </div>
  );
}

function KvEditor({
  label,
  placeholderK,
  placeholderV,
  value,
  onChange,
}: {
  label: string;
  placeholderK: string;
  placeholderV: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(value);
  const [draftKey, setDraftKey] = useState("");
  const [draftVal, setDraftVal] = useState("");
  const setEntry = (k: string, v: string) => {
    const next = { ...value };
    next[k] = v;
    onChange(next);
  };
  const renameEntry = (oldK: string, newK: string) => {
    if (oldK === newK) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      next[k === oldK ? newK : k] = v;
    }
    onChange(next);
  };
  const removeEntry = (k: string) => {
    const next = { ...value };
    delete next[k];
    onChange(next);
  };
  const addDraft = () => {
    if (!draftKey.trim()) return;
    setEntry(draftKey.trim(), draftVal);
    setDraftKey("");
    setDraftVal("");
  };
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {entries.map(([k, v]) => (
        <div key={k} className="kv">
          <input
            value={k}
            onChange={(e) => renameEntry(k, e.target.value)}
            placeholder={placeholderK}
          />
          <input
            value={v}
            onChange={(e) => setEntry(k, e.target.value)}
            placeholder={placeholderV}
          />
          <button type="button" className="danger-text" onClick={() => removeEntry(k)}>×</button>
        </div>
      ))}
      <div className="kv">
        <input
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder={placeholderK}
          onKeyDown={(e) => e.key === "Enter" && addDraft()}
        />
        <input
          value={draftVal}
          onChange={(e) => setDraftVal(e.target.value)}
          placeholder={placeholderV}
          onKeyDown={(e) => e.key === "Enter" && addDraft()}
        />
        <button type="button" className="ghost" onClick={addDraft}>+</button>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="labeled">
      <span>{label}</span>
      {children}
    </label>
  );
}

function niceType(type: string | null): string {
  if (!type) return "Element";
  return type.replace("bpmn:", "");
}
