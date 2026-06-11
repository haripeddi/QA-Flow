import OpenAI from "openai";
import { blankBpmnXml } from "./processes.ts";
import { capturePageContext } from "./workers/browser-worker.ts";
import type {
  BrowserStep,
  BrowserTestDef,
  ElementRole,
  TargetStrategy,
} from "./tags.ts";

function client(): OpenAI {
  // Read lazily so a .env loaded at startup is always picked up regardless of
  // module import order.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("sk-REPLACE")) {
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

const ALLOWED_BROWSER_ACTIONS: BrowserStep["action"][] = [
  "goto",
  "click",
  "fill",
  "press",
  "screenshot",
  "assertContains",
  "assertVisible",
  "extractText",
];

const VALID_TARGET_STRATEGIES: TargetStrategy[] = [
  "role",
  "text",
  "css",
  "id",
  "xpath",
  "label",
  "placeholder",
  "testid",
];

const VALID_ELEMENT_ROLES: ElementRole[] = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "heading",
  "combobox",
  "dialog",
  "tab",
  "menuitem",
  "switch",
  "slider",
  "gridcell",
  "image",
  "alert",
];

const BROWSER_AUTOMATION_SYSTEM_PROMPT = `# Role & Output Constraints
You are a deterministic Test Automation Planner. You translate user natural language descriptions into an array of structured JSON browser actions strictly matching the defined BrowserStep[] schema.

Return ONLY JSON: { "steps": [ { "action", "target"?: { "strategy", "value", "roleType"? }, "textValue"?, "url"?, "variable"?, "timeoutMs"?, "name"? } ] }.
Allowed actions: ${ALLOWED_BROWSER_ACTIONS.join(", ")}.

# Element Location Priorities (CRITICAL)
When identifying interactive target UI coordinates, you must strictly follow this locator hierarchy:

1. ROLE: Use this if the target element matches standard HTML semantic elements (buttons, links, text inputs, headers, alerts).
   - Set "strategy" to "role".
   - Set "roleType" to a lowercase HTML/ARIA semantic role ONLY (e.g. "button", "link", "textbox", "tab"). Allowed values: ${VALID_ELEMENT_ROLES.join(", ")}.
   - Set "value" to the element's visible or accessible name / label text (e.g. "Book a Demo", "Sign in").
   - CRITICAL: NEVER put button/link label text in "roleType". Example for a "Book a Demo" button: { "strategy": "role", "roleType": "button", "value": "Book a Demo" } — NOT { "roleType": "Book a Demo" }.
2. LABEL / PLACEHOLDER: Use this for form element wrappers that are bounded to a text label or placeholder string.
   - Set "strategy" to "label" or "placeholder".
   - Set "value" to the literal label string.
3. TEXT: Use this to interact with static copy paragraphs, standard spans, headers, or alerts.
   - Set "strategy" to "text".
   - Set "value" to the string context.
4. CSS / ID / XPATH (Fallback): Only use this if the natural language step explicitly notes an ID or CSS tag.
   - BANNED PATTERN: Never construct raw text-matching paths or fake CSS attributes inside the value property. Expressions like a[text='Login'] or div:has-text('Submit') are strictly forbidden.

# Output Mode
Do not write narrative markdown prose explanation. Return valid JSON payloads only.

Additional rules:
- Start with a goto if a URL is known.
- Use fill for typing (needs target + textValue), click for clicking (needs target).
- assertContains verifies on-page text (needs textValue, always case-insensitive).
- assertVisible checks element visibility (needs target).
- extractText reads text from an element (needs target + variable where variable is the output param name).
- screenshot captures evidence (optional name).
- The action text is the user operation; EXPECT text is only the post-action assertion. Never choose a click target solely because it appears in EXPECT.
- For page titles or "title contains" checks, use assertContains with the expected title text. Do NOT use assertVisible for browser titles.
- For long marketing copy or animated hero text, prefer assertContains over assertVisible unless the exact semantic heading appears in the live accessibility snapshot.
- When a step says a section "mentions A, B, and C", emit separate assertContains steps for each named item. Do NOT emit one assertContains containing the whole comma-separated list.
- For click targets, prefer the exact accessible name from the live snapshot. Avoid generic CTA labels like "Learn more" when the action includes context such as "about Applied AI"; choose the matching contextual link/button name or href instead.
- Only emit extractText for Outputs that include an explicit selector. If an output says "(no selector — skip extractText)", never invent an extractText target for it.
- PRESERVE {{variableName}} placeholders verbatim in url/textValue/target.value fields.
- Add a screenshot after meaningful steps where useful.
- Do NOT emit two consecutive steps with the same action and identical target.`;

function normalizedWords(value: string | undefined): Set<string> {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "should",
    "available",
    "button",
    "click",
    "open",
    "page",
    "window",
    "top",
    "right",
    "left",
  ]);
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stop.has(word)),
  );
}

function targetText(target: BrowserStep["target"] | undefined): string {
  return target?.value ?? "";
}

function stepFingerprint(step: BrowserStep): string {
  const t = step.target;
  return [
    step.action,
    t?.strategy ?? "",
    t?.value ?? "",
    t?.roleType ?? "",
    step.url ?? "",
    step.textValue ?? "",
  ].join("|");
}

function isDuplicateOfPrevious(
  prev: BrowserStep | undefined,
  curr: BrowserStep,
): boolean {
  if (!prev) return false;
  return stepFingerprint(prev) === stepFingerprint(curr);
}

function quotedPhrases(input: GenerateAutomationInput): Set<string> {
  const phrases = new Set<string>();
  for (const step of input.steps) {
    for (const text of [step.action, step.expectedResult ?? ""]) {
      for (const match of text.matchAll(/["“]([^"”]{3,})["”]/g)) {
        phrases.add(match[1].trim().toLowerCase());
      }
    }
  }
  return phrases;
}

function isStatusAssertionText(textValue: string, literals: Set<string>): boolean {
  const normalized = textValue.trim().toLowerCase();
  if (!normalized) return false;
  if (literals.has(normalized)) return false;
  return /\b(loads?|loaded|successfully|visible|displayed|clickable|opens?|opened|taken to|ready for interaction|not blocking|blocking|no overlay|no longer blocking)\b/i.test(
    textValue,
  );
}

const TARGET_REQUIRED_ACTIONS = new Set<BrowserStep["action"]>([
  "click",
  "fill",
  "press",
  "assertVisible",
  "extractText",
]);

function isValidElementRole(role: string): role is ElementRole {
  return VALID_ELEMENT_ROLES.includes(role as ElementRole);
}

function parseTarget(raw: unknown): BrowserStep["target"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const strategy = String(t.strategy ?? "") as TargetStrategy;
  if (!VALID_TARGET_STRATEGIES.includes(strategy)) return undefined;

  if (strategy === "role") {
    let roleType = String(t.roleType ?? "").trim().toLowerCase();
    let value = String(t.value ?? "").trim();

    // Recover when the model swaps semantic role and label text.
    if (!isValidElementRole(roleType) && isValidElementRole(value.toLowerCase())) {
      const label = String(t.roleType ?? "").trim();
      roleType = value.toLowerCase();
      value = label;
    }

    if (!isValidElementRole(roleType) || !value) return undefined;
    return { strategy: "role", roleType, value };
  }

  const value = String(t.value ?? "").trim();
  if (!value) return undefined;
  return { strategy, value };
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const word of a) if (b.has(word)) return true;
  return false;
}

export interface GenerateAutomationInput {
  name: string;
  steps: Array<{ action: string; expectedResult?: string }>;
  startUrl?: string;
  inputs?: Array<{ name: string; value?: string }>;
  outputs?: Array<{ name: string; selector?: string }>;
}

/**
 * Author-time generation: turn plain-English test steps into a deterministic
 * Playwright (browser.playwright) executable. Grounds selectors in a live DOM
 * snapshot of startUrl when available. The result is meant to be reviewed by a
 * human before it is saved/run.
 */
export async function generateBrowserAutomation(
  input: GenerateAutomationInput,
): Promise<{ executable: BrowserTestDef; raw: string; grounded: boolean }> {
  const openai = client();

  let grounded = false;
  let contextBlock = "";

  if (input.startUrl) {
    const ctx = await capturePageContext(input.startUrl);
    if (ctx) {
      grounded = true;
      const els = ctx.elements
        .map(
          (e) =>
            `- role=${e.role}${e.name ? ` name="${e.name}"` : ""}${e.href ? ` href="${e.href}"` : ""}`,
        )
        .join("\n");
      contextBlock = `\n\nLive accessibility snapshot of ${ctx.url} (title: "${ctx.title}"). Prefer role-strategy targets from these semantic nodes:\n${els}`;
    }
  }

  const stepsText = input.steps
    .map(
      (s, i) => `${i + 1}. ACTION: ${s.action}`,
    )
    .join("\n");
  const expectedText = input.steps
    .map((s, i) =>
      s.expectedResult ? `${i + 1}. EXPECT AFTER ACTION ${i + 1}: ${s.expectedResult}` : "",
    )
    .filter(Boolean)
    .join("\n");

  const ioBlock =
    (input.inputs?.length ?? 0) > 0 || (input.outputs?.length ?? 0) > 0
      ? `\n\nInputs (use {{name}} placeholders in url/textValue/target.value fields):\n${
          (input.inputs ?? [])
            .map((p) => `- ${p.name}${p.value ? ` = ${p.value}` : ""}`)
            .join("\n") || "(none)"
        }\n\nOutputs (emit extractText for each with a target):\n${
          (input.outputs ?? [])
            .map(
              (p) =>
                `- ${p.name}${p.selector ? ` css=${p.selector}` : " (no selector — skip extractText)"}`,
            )
            .join("\n") || "(none)"
        }`
      : "";

  const promptContent = `Test case: ${input.name}\nStart URL: ${
    input.startUrl ?? "(infer from steps)"
  }\n\nActions to perform:\n${stepsText}${
    expectedText ? `\n\nAssertions to verify after the matching action:\n${expectedText}` : ""
  }${contextBlock}${ioBlock}`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: BROWSER_AUTOMATION_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: promptContent,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text) as { steps?: unknown };
  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];

  const steps: BrowserStep[] = [];
  const authoredActionWords = input.steps.map((s) => normalizedWords(s.action));
  const authoredExpectedWords = input.steps.map((s) =>
    normalizedWords(s.expectedResult),
  );
  const authoredLiteralPhrases = quotedPhrases(input);
  const outputSelectors = new Map(
    (input.outputs ?? [])
      .filter((p) => p.name?.trim() && p.selector?.trim())
      .map((p) => [p.name.trim(), p.selector!.trim()]),
  );
  for (const s of rawSteps as Record<string, unknown>[]) {
    const action = String(s.action ?? "") as BrowserStep["action"];
    if (!ALLOWED_BROWSER_ACTIONS.includes(action)) continue;
    const target = parseTarget(s.target);
    if (TARGET_REQUIRED_ACTIONS.has(action) && !target) continue;
    const step: BrowserStep = { action };
    if (target) step.target = target;
    if (typeof s.url === "string") step.url = s.url;
    if (typeof s.textValue === "string") step.textValue = s.textValue;
    if (typeof s.timeoutMs === "number") step.timeoutMs = s.timeoutMs;
    if (typeof s.name === "string") step.name = s.name;
    if (typeof s.variable === "string") step.variable = s.variable;
    if (action === "extractText" && step.variable && !outputSelectors.has(step.variable)) {      continue;
    }
    if (
      action === "assertContains" &&
      step.textValue &&
      isStatusAssertionText(step.textValue, authoredLiteralPhrases)
    ) {      continue;
    }
    if (action === "click" && step.target) {
      const targetWords = normalizedWords(targetText(step.target));
      const matchesAction = authoredActionWords.some((words) =>
        hasOverlap(targetWords, words),
      );
      const matchesExpected = authoredExpectedWords.some((words) =>
        hasOverlap(targetWords, words),
      );
      if (!matchesAction && matchesExpected) continue;
    }
    if (isDuplicateOfPrevious(steps[steps.length - 1], step)) continue;
    steps.push(step);
  }

  if (input.startUrl && !steps.some((s) => s.action === "goto")) {
    steps.unshift({ action: "goto", url: input.startUrl });
  }

  for (const out of input.outputs ?? []) {
    if (!out.name?.trim() || !out.selector?.trim()) continue;
    const already = steps.some(
      (s) => s.action === "extractText" && s.variable === out.name.trim(),
    );
    if (!already) {
      steps.push({
        action: "extractText",
        target: { strategy: "css", value: out.selector.trim() },
        variable: out.name.trim(),
      });
    }
  }
  if (steps.length === 0) {
    throw new Error("model did not return any valid browser steps");
  }

  return {
    executable: {
      name: input.name || "Generated automation",
      type: "browser.playwright",
      steps,
    },
    raw: text,
    grounded,
  };
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
