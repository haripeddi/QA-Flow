import OpenAI from "openai";
import { blankBpmnXml } from "./processes.ts";

const apiKey = process.env.OPENAI_API_KEY;

function client(): OpenAI {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey });
}

function extractBpmnXml(text: string): string {
  const fenced = /```(?:xml)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1].trim() : text.trim();
  if (!raw.includes("<bpmn:process")) {
    throw new Error("model response did not contain BPMN process XML");
  }
  return raw;
}

export async function generateWorkflowFromPrompt(
  processKey: string,
  prompt: string,
): Promise<{ bpmnXml: string; explanation: string }> {
  const openai = client();
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You generate valid BPMN 2.0 XML for QA Flow. Use camunda namespace on service tasks. " +
          "Return only BPMN XML in a fenced code block. Process id must match the user key.",
      },
      {
        role: "user",
        content: `Process key: ${processKey}\nRequest: ${prompt}\n\nTemplate reference:\n${blankBpmnXml(processKey, processKey)}`,
      },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? "";
  const bpmnXml = extractBpmnXml(text);
  return { bpmnXml, explanation: text };
}

export async function modifyWorkflow(
  processKey: string,
  currentXml: string,
  instruction: string,
): Promise<{ bpmnXml: string; explanation: string }> {
  const openai = client();
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You edit BPMN 2.0 XML for QA Flow. Return the full updated XML in a fenced code block only.",
      },
      {
        role: "user",
        content: `Process key: ${processKey}\nInstruction: ${instruction}\n\nCurrent XML:\n${currentXml}`,
      },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? "";
  const bpmnXml = extractBpmnXml(text);
  return { bpmnXml, explanation: text };
}

export async function recommendTestAssets(input: {
  processKey: string;
  nodeId: string;
  nodeName?: string;
  bpmnXml: string;
  planSummary?: string;
}): Promise<{
  suites: Array<{ name: string; scenarios: Array<{ name: string; cases: Array<{ name: string; steps: Array<{ name: string; action: string; expectedResult?: string }> }> }> }>;
  raw: string;
}> {
  const openai = client();
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'Return JSON: { "suites": [{ "name", "scenarios": [{ "name", "cases": [{ "name", "steps": [{ "name", "action", "expectedResult" }] }] }] }] }',
      },
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text) as {
    suites?: Array<{
      name: string;
      scenarios: Array<{
        name: string;
        cases: Array<{
          name: string;
          steps: Array<{ name: string; action: string; expectedResult?: string }>;
        }>;
      }>;
    }>;
  };
  return { suites: parsed.suites ?? [], raw: text };
}
