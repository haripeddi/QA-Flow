import { useState } from "react";
import {
  aiGenerateWorkflow,
  aiModifyWorkflow,
  aiRecommendAssets,
  newPlanId,
  fetchPlan,
  savePlan,
} from "../api";

interface Props {
  processKey: string;
  bpmnXml: string;
  selectedNodeId?: string | null;
  selectedNodeName?: string;
  onApplyBpmn: (xml: string) => void;
}

export default function CopilotPanel({
  processKey,
  bpmnXml,
  selectedNodeId,
  selectedNodeName,
  onApplyBpmn,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const res = await aiGenerateWorkflow(processKey, prompt);
      setMessages((m) => [...m, res.explanation]);
      onApplyBpmn(res.bpmnXml);
    } catch (e) {
      setMessages((m) => [...m, `Error: ${(e as Error).message}`]);
    } finally {
      setBusy(false);
    }
  };

  const modify = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const res = await aiModifyWorkflow(processKey, bpmnXml, prompt);
      setMessages((m) => [...m, res.explanation]);
      onApplyBpmn(res.bpmnXml);
    } catch (e) {
      setMessages((m) => [...m, `Error: ${(e as Error).message}`]);
    } finally {
      setBusy(false);
    }
  };

  const recommend = async () => {
    if (!selectedNodeId) return;
    setBusy(true);
    try {
      const res = await aiRecommendAssets({
        processKey,
        nodeId: selectedNodeId,
        nodeName: selectedNodeName,
        bpmnXml,
      });
      const plan = await fetchPlan(processKey);
      const node = plan.nodes[selectedNodeId] ?? {
        nodeId: selectedNodeId,
        suites: [],
      };
      for (const suite of res.suites) {
        const suiteId = newPlanId();
        const scenarios = suite.scenarios.map((sc) => ({
          id: newPlanId(),
          name: sc.name,
          cases: sc.cases.map((c) => ({
            id: newPlanId(),
            name: c.name,
            steps: c.steps.map((s) => ({
              id: newPlanId(),
              name: s.name,
              action: s.action,
              expectedResult: s.expectedResult,
            })),
            dataSets: [],
          })),
        }));
        node.suites.push({ id: suiteId, name: suite.name, scenarios });
      }
      plan.nodes[selectedNodeId] = node;
      await savePlan(processKey, plan);
      setMessages((m) => [...m, `Inserted ${res.suites.length} suite(s) into plan.`]);
    } catch (e) {
      setMessages((m) => [...m, `Error: ${(e as Error).message}`]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="copilot-panel">
      <h3>AI Copilot</h3>
      <textarea
        rows={4}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe a workflow or test assets to generate…"
      />
      <div className="copilot-actions">
        <button type="button" disabled={busy} onClick={generate}>Generate workflow</button>
        <button type="button" disabled={busy} onClick={modify}>Modify workflow</button>
        <button type="button" disabled={busy || !selectedNodeId} onClick={recommend}>
          Recommend tests
        </button>
      </div>
      <div className="copilot-messages">
        {messages.map((m, i) => (
          <pre key={i} className="script-output">{m}</pre>
        ))}
      </div>
    </div>
  );
}
