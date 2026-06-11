import { promises as fs } from "node:fs";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Locator,
  type Page,
} from "playwright";
import { SCREENSHOTS_DIR } from "../config.ts";
import type {
  BrowserStep,
  BrowserTestDef,
  ElementRole,
  TargetStrategy,
} from "../tags.ts";

export interface BrowserStepResult {
  index: number;
  action: string;
  name?: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
  screenshotUrl?: string;
  durationMs: number;
  extractedValue?: string;
}

export interface BrowserExecutionResult {
  passed: boolean;
  reasons: string[];
  durationMs: number;
  steps: BrowserStepResult[];
  /** Variables extracted during execution (e.g. extractText steps). */
  variables: Record<string, unknown>;
}

let sharedBrowser: Browser | undefined;
const browserSessions = new Map<string, BrowserSession>();
const SESSION_IDLE_MS = 2 * 60 * 1000;

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  closeTimer?: NodeJS.Timeout;
  popupHandlerAttached?: boolean;
}

type LocatorScope = Page | Frame;

function locatorScopePage(scope: LocatorScope): Page {
  if ("mainFrame" in scope) return scope as Page;
  return (scope as Frame).page();
}

const INTERACTION_ACTIONS = new Set<BrowserStep["action"]>([
  "click",
  "fill",
  "press",
  "assertVisible",
  "assertContains",
  "extractText",
]);

const INTERACTIVE_A11Y_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "combobox",
  "tab",
  "menuitem",
  "heading",
  "dialog",
  "alert",
  "switch",
  "slider",
  "gridcell",
  "image",
  "searchbox",
]);

const OVERLAY_DISMISS_TARGETS: Array<{
  strategy: TargetStrategy;
  value: string;
  roleType?: ElementRole;
}> = [
  { strategy: "role", roleType: "button", value: "Accept all cookies" },
  { strategy: "role", roleType: "button", value: "Accept all" },
  { strategy: "role", roleType: "button", value: "Allow all" },
  { strategy: "role", roleType: "button", value: "Accept cookies" },
  { strategy: "role", roleType: "button", value: "Accept" },
  { strategy: "role", roleType: "button", value: "Agree" },
  { strategy: "role", roleType: "button", value: "I agree" },
  { strategy: "role", roleType: "button", value: "Reject all" },
  { strategy: "role", roleType: "button", value: "Decline" },
  { strategy: "role", roleType: "button", value: "No thanks" },
  { strategy: "role", roleType: "button", value: "Continue" },
  { strategy: "role", roleType: "button", value: "Got it" },
  { strategy: "role", roleType: "button", value: "Close" },
  { strategy: "role", roleType: "button", value: "Dismiss" },
  { strategy: "text", value: "×" },
  {
    strategy: "css",
    value:
      '[aria-label*="close" i], [aria-label*="dismiss" i], button.close, .close-button, .modal-close',
  },
];

function isCloseLikeTarget(target: BrowserStep["target"]): boolean {
  return Boolean(target && /close|dismiss|×/i.test(target.value));
}

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  const isCloud =
    process.env.HF_SPACE_ID !== undefined || process.env.NODE_ENV === "production";
  const configuredChannel = process.env.PLAYWRIGHT_CHANNEL;
  const channel =
    configuredChannel === "none"
      ? undefined
      : configuredChannel ?? (isCloud ? undefined : "chrome");

  sharedBrowser = await chromium.launch({
    ...(channel ? { channel } : {}),
    headless: process.env.PLAYWRIGHT_HEADLESS
      ? process.env.PLAYWRIGHT_HEADLESS !== "false"
      : isCloud,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  return sharedBrowser;
}

export async function closeBrowser() {
  for (const session of browserSessions.values()) {
    if (session.closeTimer) clearTimeout(session.closeTimer);
    try {
      await session.context.close();
    } catch {}
  }
  browserSessions.clear();
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {}
    sharedBrowser = undefined;
  }
}

interface RunCtx {
  runId: string;
  activityId: string;
  processKey?: string;
}

async function getSession(ctx: RunCtx): Promise<BrowserSession> {
  const existing = browserSessions.get(ctx.runId);
  if (existing && !existing.page.isClosed()) {
    if (existing.closeTimer) clearTimeout(existing.closeTimer);
    return existing;
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const session: BrowserSession = { context, page, popupHandlerAttached: true };
  attachPopupOverlayHandler(context);
  browserSessions.set(ctx.runId, session);
  return session;
}

function attachPopupOverlayHandler(context: BrowserContext): void {
  context.on("page", (popupPage) => {
    void (async () => {
      try {
        await popupPage
          .waitForLoadState("domcontentloaded", { timeout: 10000 })
          .catch(() => {});
        await popupPage.waitForTimeout(400);
        await dismissOverlaysAllPages(popupPage);
      } catch {}
    })();
  });
}

function scheduleSessionClose(runId: string) {
  const session = browserSessions.get(runId);
  if (!session) return;
  if (session.closeTimer) clearTimeout(session.closeTimer);
  session.closeTimer = setTimeout(() => {
    browserSessions.delete(runId);
    session.context.close().catch(() => {});
  }, SESSION_IDLE_MS);
}

/**
 * Maps schema ElementRole values to Playwright ARIA role names where they differ.
 */
function toPlaywrightRole(roleType: ElementRole): Parameters<Page["getByRole"]>[0] {
  if (roleType === "image") return "img";
  return roleType as Parameters<Page["getByRole"]>[0];
}

function formatTargetForError(target: NonNullable<BrowserStep["target"]>): string {
  if (target.strategy === "role") {
    return `role=${target.roleType ?? "?"} name="${target.value}"`;
  }
  return `${target.strategy}="${target.value}"`;
}

function normalizeForTextMatch(value: string): string {
  return value
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitListAssertion(value: string): string[] {
  if (!value.includes(",") && !/\s+and\s+/i.test(value)) return [];
  const parts = value
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map((part) => part.trim().replace(/^and\s+/i, ""))
    .filter((part) => part.length >= 2);
  return parts.length >= 2 ? parts : [];
}

/**
 * Resolves an abstract schema token systematically into an auto-waiting Playwright Locator.
 */
async function resolveLocatorCandidates(
  scope: LocatorScope,
  target: BrowserStep["target"],
): Promise<Locator> {
  if (!target) {
    throw new Error("Target definitions are missing for this execution context block.");
  }

  let locator: Locator;

  switch (target.strategy) {
    case "role": {
      if (!target.roleType) {
        throw new Error("roleType property missing from incoming role strategy step payload.");
      }
      const role = toPlaywrightRole(target.roleType);
      locator = scope.getByRole(role, {
        name: target.value,
        exact: false,
      });
      if (target.roleType === "button" || target.roleType === "link") {
        const alternateRole = target.roleType === "button" ? "link" : "button";
        locator = locator
          .or(scope.getByRole(alternateRole, { name: target.value, exact: false }))
          .or(
            scope
              .locator("a,button,[role='button'],[role='link']")
              .filter({ hasText: target.value }),
          );
      }
      break;
    }

    case "text":
      locator = scope.getByText(target.value, { exact: false });
      break;

    case "label":
      locator = scope.getByLabel(target.value, { exact: false });
      break;

    case "placeholder":
      locator = scope.getByPlaceholder(target.value, { exact: false });
      break;

    case "testid":
      locator = scope.getByTestId(target.value);
      break;

    case "id":
      locator = scope.locator(`#${target.value}`);
      break;

    case "css":
      locator = scope.locator(target.value);
      break;

    case "xpath":
      locator = scope.locator(`xpath=${target.value}`);
      break;

    default:
      throw new Error(
        `Unsupported automation strategy directive received: ${(target as { strategy: string }).strategy}`,
      );
  }

  return locator.filter({ visible: true });
}

async function resolveLocator(
  scope: LocatorScope,
  target: BrowserStep["target"],
): Promise<Locator> {
  return (await resolveLocatorCandidates(scope, target)).first();
}

interface PageTelemetry {
  url: string;
  pendingRequests: number;
  domFingerprint: string;
}

class RequestTracker {
  pending = 0;

  attach(page: Page) {
    const onRequest = () => {
      this.pending++;
    };
    const onDone = () => {
      this.pending = Math.max(0, this.pending - 1);
    };
    page.on("request", onRequest);
    page.on("requestfinished", onDone);
    page.on("requestfailed", onDone);
    return () => {
      page.off("request", onRequest);
      page.off("requestfinished", onDone);
      page.off("requestfailed", onDone);
    };
  }
}

async function captureTelemetry(
  page: Page,
  tracker: RequestTracker,
): Promise<PageTelemetry> {
  const domFingerprint = await page
    .evaluate(
      () =>
        `${document.body?.childElementCount ?? 0}:${document.querySelectorAll("*").length}`,
    )
    .catch(() => "0:0");
  return {
    url: page.url(),
    pendingRequests: tracker.pending,
    domFingerprint,
  };
}

function telemetryChanged(before: PageTelemetry, after: PageTelemetry): boolean {
  return (
    before.url !== after.url ||
    before.pendingRequests !== after.pendingRequests ||
    before.domFingerprint !== after.domFingerprint
  );
}

async function collectTextMatchEvidence(
  page: Page,
  needle: string,
): Promise<Record<string, unknown>> {
  const title = await page.title().catch(() => "");
  const bodyText = await page
    .locator("body")
    .evaluate((b) => {
      const clone = b.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
      return clone.textContent ?? "";
    })
    .catch(() => "");
  const normalizedNeedle = normalizeForTextMatch(needle);
  const normalizedTitle = normalizeForTextMatch(title);
  const normalizedBody = normalizeForTextMatch(bodyText);
  const stripWhitespace = (value: string) => value.replace(/\s+/g, "");
  const looseNeedle = stripWhitespace(normalizedNeedle);
  const foundWhitespaceInsensitive =
    looseNeedle.length > 0 &&
    (stripWhitespace(normalizedBody).includes(looseNeedle) ||
      stripWhitespace(normalizedTitle).includes(looseNeedle));
  const searchTerms = Array.from(
    new Set(
      needle
        .toLowerCase()
        .match(/[a-z0-9%+]+/g)
        ?.filter((term) => term.length >= 3 || /\d/.test(term)) ?? [],
    ),
  );
  const nearbySnippets = searchTerms
    .map((term) => {
      const idx = normalizedBody.indexOf(term);
      if (idx < 0) return { term, found: false };
      return {
        term,
        found: true,
        snippet: normalizedBody.slice(Math.max(0, idx - 80), idx + term.length + 120),
      };
    })
    .slice(0, 8);
  const numericSnippets = Array.from(
    new Set(
      (bodyText.match(/.{0,60}\b\d[\dA-Za-z%+.-]*\b.{0,90}/g) ?? []).map((s) =>
        s.replace(/\s+/g, " ").trim(),
      ),
    ),
  ).slice(0, 12);
  return {
    foundInTitle: normalizedTitle.includes(normalizedNeedle),
    foundInBodyText: normalizedBody.includes(normalizedNeedle),
    foundWhitespaceInsensitive,
    nearbySnippets,
    numericSnippets,
    title,
    bodyPreview: bodyText.replace(/\s+/g, " ").trim().slice(0, 240),
  };
}

async function waitForTelemetryChange(
  page: Page,
  before: PageTelemetry,
  tracker: RequestTracker,
  windowMs: number,
): Promise<boolean> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const after = await captureTelemetry(page, tracker);
    if (telemetryChanged(before, after)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/** Post-action hydration: re-fire once if the page shows no telemetry change. */
async function runWithHydrationCheck(
  page: Page,
  fn: () => Promise<void>,
): Promise<void> {
  const tracker = new RequestTracker();
  const detach = tracker.attach(page);
  try {
    const before = await captureTelemetry(page, tracker);
    await fn();
    const changed = await waitForTelemetryChange(page, before, tracker, 1500);
    if (!changed) {
      await page.waitForTimeout(500);
      await fn();
    }
  } finally {
    detach();
  }
}

function isTimeoutError(err: unknown): boolean {
  const msg = (err as Error).message ?? "";
  return /timeout|timed out/i.test(msg);
}

async function inspectTargetAcrossPages(
  page: Page,
  target: BrowserStep["target"],
): Promise<Record<string, unknown>> {
  if (!target) return { hasTarget: false };
  const pages = page.context().pages();
  let frameCount = 0;
  let visibleFrames = 0;
  let matchedFrames = 0;
  for (const activePage of pages) {
    if (activePage.isClosed()) continue;
    for (const frame of activePage.frames()) {
      if (frame.isDetached()) continue;
      frameCount++;
      try {
        const locator = await resolveLocator(frame, target);
        const matched = await locator.count().catch(() => 0);
        if (matched > 0) matchedFrames++;
        if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
          visibleFrames++;
        }
      } catch {}
    }
  }
  return { pageCount: pages.length, frameCount, matchedFrames, visibleFrames };
}

async function resolveVisibleLocatorAcrossPages(
  page: Page,
  target: BrowserStep["target"],
): Promise<{ locator: Locator; inMainFrame: boolean; frameCount: number }> {
  let frameCount = 0;
  for (const activePage of page.context().pages()) {
    if (activePage.isClosed()) continue;
    for (const frame of activePage.frames()) {
      if (frame.isDetached()) continue;
      frameCount++;
      try {
        const locator = await resolveLocator(frame, target);
        if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
          return {
            locator,
            inMainFrame: activePage === page && frame === page.mainFrame(),
            frameCount,
          };
        }
      } catch {}
    }
  }
  return { locator: await resolveLocator(page, target), inMainFrame: true, frameCount };
}

async function resolveActionableClickLocatorAcrossPages(
  page: Page,
  target: BrowserStep["target"],
): Promise<{
  locator: Locator;
  inMainFrame: boolean;
  frameCount: number;
  candidateIndex: number;
  trial: { ok: boolean; message?: string };
}> {
  let frameCount = 0;
  let fallback:
    | {
        locator: Locator;
        inMainFrame: boolean;
        frameCount: number;
        candidateIndex: number;
        trial: { ok: boolean; message?: string };
      }
    | undefined;

  for (const activePage of page.context().pages()) {
    if (activePage.isClosed()) continue;
    for (const frame of activePage.frames()) {
      if (frame.isDetached()) continue;
      frameCount++;
      try {
        const candidates = await resolveLocatorCandidates(frame, target);
        const count = Math.min(await candidates.count().catch(() => 0), 10);
        for (let i = 0; i < count; i++) {
          const candidate = candidates.nth(i);
          if (!(await candidate.isVisible({ timeout: 250 }).catch(() => false))) {
            continue;
          }
          const trial = await candidate
            .click({ timeout: 1000, trial: true })
            .then(() => ({ ok: true }))
            .catch((err) => ({
              ok: false,
              message: (err as Error).message.split("\n").slice(0, 5).join(" | "),
            }));
          const resolved = {
            locator: candidate,
            inMainFrame: activePage === page && frame === page.mainFrame(),
            frameCount,
            candidateIndex: i,
            trial,
          };
          if (trial.ok) return resolved;
          fallback ??= resolved;
        }
      } catch {}
    }
  }

  if (fallback) return fallback;
  return {
    locator: await resolveLocator(page, target),
    inMainFrame: true,
    frameCount,
    candidateIndex: 0,
    trial: { ok: false, message: "no visible actionable candidates found" },
  };
}

async function dismissIntrusiveOverlaysOnFrame(scope: LocatorScope): Promise<boolean> {
  const dialog = scope.getByRole("dialog").first();
  if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
    for (const target of OVERLAY_DISMISS_TARGETS) {
      try {
        const closeBtn = await resolveLocator(scope, target);
        if (await closeBtn.isVisible({ timeout: 500 })) {
          await closeBtn.click({ timeout: 3000 });
          await locatorScopePage(scope).waitForTimeout(400);
          return true;
        }
      } catch {}
    }
  }

  const alert = scope.getByRole("alert").first();
  if (await alert.isVisible({ timeout: 500 }).catch(() => false)) {
    for (const target of OVERLAY_DISMISS_TARGETS) {
      try {
        const closeBtn = await resolveLocator(scope, target);
        if (await closeBtn.isVisible({ timeout: 500 })) {
          await closeBtn.click({ timeout: 3000 });
          await locatorScopePage(scope).waitForTimeout(400);
          return true;
        }
      } catch {}
    }
  }

  for (const target of OVERLAY_DISMISS_TARGETS) {
    try {
      const loc = await resolveLocator(scope, target);
      if (await loc.isVisible({ timeout: 500 })) {
        await loc.click({ timeout: 3000 });
        await locatorScopePage(scope).waitForTimeout(400);
        return true;
      }
    } catch {}
  }

  return false;
}

async function dismissOverlaysAllPages(page: Page): Promise<boolean> {
  const context = page.context();
  let dismissed = false;
  for (const activePage of context.pages()) {
    if (activePage.isClosed()) continue;
    for (const frame of activePage.frames()) {
      if (frame.isDetached()) continue;
      try {
        if (await dismissIntrusiveOverlaysOnFrame(frame)) dismissed = true;
      } catch {}
    }
  }
  return dismissed;
}

async function dismissIntrusiveOverlays(page: Page): Promise<boolean> {
  return dismissOverlaysAllPages(page);
}

export async function runBrowserTest(
  test: BrowserTestDef,
  ctx: RunCtx,
): Promise<BrowserExecutionResult> {
  const overallStart = Date.now();
  const reasons: string[] = [];
  const steps: BrowserStepResult[] = [];
  const variables: Record<string, unknown> = {};
  let passed = true;

  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  const { page } = await getSession(ctx);

  let stepIndex = 0;
  try {
    for (const step of test.steps) {
      const result = await runStep(page, step, stepIndex, ctx);
      steps.push(result);
      if (
        step.action === "extractText" &&
        step.variable &&
        result.status === "passed" &&
        result.extractedValue !== undefined
      ) {
        variables[step.variable] = result.extractedValue;
      }
      if (result.status === "failed") {
        passed = false;
        reasons.push(`step ${stepIndex} (${step.action}): ${result.message}`);
        const failShot = await captureScreenshot(
          page,
          ctx,
          `step-${stepIndex}-failure`,
        );
        if (failShot) {
          steps.push({
            index: stepIndex,
            action: "screenshot",
            name: "failure-screenshot",
            status: "passed",
            screenshotUrl: failShot,
            durationMs: 0,
          });
        }
        break;
      }
      stepIndex++;
    }
  } finally {
    scheduleSessionClose(ctx.runId);
  }

  return {
    passed,
    reasons,
    durationMs: Date.now() - overallStart,
    steps,
    variables,
  };
}

async function executeStepCore(
  page: Page,
  step: BrowserStep,
  index: number,
  ctx: RunCtx,
  start: number,
): Promise<BrowserStepResult> {
  const timeout = step.timeoutMs ?? 20000;
  const base: BrowserStepResult = {
    index,
    action: step.action,
    name: step.name,
    status: "passed",
    durationMs: 0,
  };

  if (INTERACTION_ACTIONS.has(step.action)) {
    await dismissOverlaysAllPages(page).catch(() => false);
  }

  switch (step.action) {
    case "goto":
      if (!step.url) throw new Error("goto requires 'url'");
      const currentPageUrl = page.url();
      const gotoUrl =
        step.url.startsWith("/") && /^https?:\/\//i.test(currentPageUrl)
          ? new URL(step.url, currentPageUrl).toString()
          : step.url;
      await page.goto(gotoUrl, { timeout, waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
      await dismissOverlaysAllPages(page).catch(() => {});
      break;
    case "click": {
      if (!step.target) throw new Error("click requires 'target'");
      const clickState = await inspectTargetAcrossPages(page, step.target);
      if (
        isCloseLikeTarget(step.target) &&
        typeof clickState.visibleFrames === "number" &&
        clickState.visibleFrames === 0
      ) {
        break;
      }
      const resolved = await resolveActionableClickLocatorAcrossPages(page, step.target);
      const locator = resolved.locator;
      const trial = resolved.trial;
      if (isCloseLikeTarget(step.target)) {
        if (!trial.ok) {
          await locator.dispatchEvent("click").catch(() => undefined);
          await page.waitForTimeout(400);
          const afterDispatch = await inspectTargetAcrossPages(page, step.target);
          if (
            typeof afterDispatch.visibleFrames === "number" &&
            afterDispatch.visibleFrames === 0
          ) {
            break;
          }

          const box = await locator.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(
              () => undefined,
            );
            await page.waitForTimeout(400);
            const afterMouse = await inspectTargetAcrossPages(page, step.target);
            if (
              typeof afterMouse.visibleFrames === "number" &&
              afterMouse.visibleFrames === 0
            ) {
              break;
            }
          }
          break;
        }
      }
      await runWithHydrationCheck(page, async () => {
        await locator.click({ timeout });
      });
      break;
    }
    case "fill": {
      if (!step.target || step.textValue === undefined) {
        throw new Error("fill requires 'target' and 'textValue'");
      }
      const { locator } = await resolveVisibleLocatorAcrossPages(page, step.target);
      await runWithHydrationCheck(page, async () => {
        await locator.fill(step.textValue!, { timeout });
      });
      break;
    }
    case "press": {
      if (!step.target || !step.textValue) {
        throw new Error("press requires 'target' and 'textValue' (key)");
      }
      const { locator } = await resolveVisibleLocatorAcrossPages(page, step.target);
      await locator.press(step.textValue, { timeout });
      break;
    }
    case "screenshot": {
      const url = await captureScreenshot(page, ctx, step.name ?? `step-${index}`);
      return {
        ...base,
        status: "passed",
        screenshotUrl: url,
        durationMs: Date.now() - start,
      };
    }
    case "assertContains": {
      if (!step.textValue) throw new Error("assertContains requires 'textValue'");
      const needle = step.textValue;

      // Primary: use Playwright's text engine, which auto-waits, normalizes
      // whitespace, and only matches rendered text. This is robust to sites
      // that wrap each letter of a heading in its own animated <span> (where
      // body.innerText injects spurious line breaks between letters) and to
      // hidden <script> JSON (which is never matched as visible text).
      let found = false;
      try {
        found = await page
          .getByText(needle, { exact: false })
          .first()
          .isVisible({ timeout });
      } catch {}

      // Fallback: whitespace- and quote-normalized match over visible text
      // content (script/style stripped), in case the phrase spans multiple
      // sibling elements that getByText does not group together.
      const title = await page.title().catch(() => "");
      const visibleText = await page
        .locator("body")
        .evaluate((b) => {
          const clone = b.cloneNode(true) as HTMLElement;
          clone
            .querySelectorAll("script,style,noscript")
            .forEach((n) => n.remove());
          return clone.textContent ?? "";
        })
        .catch(() => "");
      const haystack = normalizeForTextMatch(`${title} ${visibleText}`);
      const normalizedNeedle = normalizeForTextMatch(needle);
      const fallbackFound = haystack.includes(normalizedNeedle);
      if (!found) found = fallbackFound;
      const looseHaystack = haystack.replace(/\s+/g, "");
      const looseNeedle = normalizedNeedle.replace(/\s+/g, "");
      const looseFound = looseNeedle.length > 0 && looseHaystack.includes(looseNeedle);
      if (!found) found = looseFound;
      const listParts = splitListAssertion(needle);
      const listEvidence =
        !found && listParts.length > 0
          ? listParts.map((part) => ({
              part,
              found: haystack.includes(normalizeForTextMatch(part)),
            }))
          : [];
      if (!found && listEvidence.length > 0) {
        found = listEvidence.every((entry) => entry.found);
      }
      if (!found) {
        const body = await page
          .locator("body")
          .innerText({ timeout })
          .catch(() => "");
        throw new Error(
          `page body does not contain "${needle}". First 400 chars: ${body.slice(0, 400)}`,
        );
      }
      break;
    }
    case "assertVisible": {
      if (!step.target) throw new Error("assertVisible requires 'target'");
      const currentState = await inspectTargetAcrossPages(page, step.target);
      if (
        isCloseLikeTarget(step.target) &&
        typeof currentState.visibleFrames === "number" &&
        currentState.visibleFrames === 0
      ) {
        break;
      }
      const resolved = await resolveVisibleLocatorAcrossPages(page, step.target);
      const locator = resolved.locator;
      let visible = await locator.isVisible({ timeout });
      let textEvidence: Record<string, unknown> | undefined;
      if (!visible && step.target.strategy === "text") {
        textEvidence = await collectTextMatchEvidence(page, step.target.value);
        visible = Boolean(
          textEvidence.foundInBodyText ||
            textEvidence.foundInTitle ||
            textEvidence.foundWhitespaceInsensitive,
        );
      }
      if (!visible) {
        throw new Error(`target ${formatTargetForError(step.target)} not visible`);
      }
      break;
    }
    case "extractText": {
      if (!step.target) throw new Error("extractText requires 'target'");
      if (!step.variable) throw new Error("extractText requires 'variable'");
      const { locator } = await resolveVisibleLocatorAcrossPages(page, step.target);
      const text = (await locator.innerText({ timeout })).trim();
      return {
        ...base,
        status: "passed",
        extractedValue: text,
        durationMs: Date.now() - start,
      };
    }
    default: {
      const exhaustive: never = step.action;
      throw new Error(`unknown action: ${exhaustive}`);
    }
  }
  return { ...base, durationMs: Date.now() - start };
}

async function runStep(
  page: Page,
  step: BrowserStep,
  index: number,
  ctx: RunCtx,
): Promise<BrowserStepResult> {
  const start = Date.now();
  const base: BrowserStepResult = {
    index,
    action: step.action,
    name: step.name,
    status: "passed",
    durationMs: 0,
  };

  try {
    return await executeStepCore(page, step, index, ctx, start);
  } catch (err) {
    if (isTimeoutError(err)) {
      const healed = await dismissIntrusiveOverlays(page);
      if (healed) {
        try {
          return await executeStepCore(page, step, index, ctx, start);
        } catch (retryErr) {
          return {
            ...base,
            status: "failed",
            message: (retryErr as Error).message.split("\n").slice(0, 4).join(" | "),
            durationMs: Date.now() - start,
          };
        }
      }
    }
    return {
      ...base,
      status: "failed",
      message: (err as Error).message.split("\n").slice(0, 4).join(" | "),
      durationMs: Date.now() - start,
    };
  }
}

export interface PageContextElement {
  role: string;
  name?: string;
  href?: string;
}

export interface PageContext {
  url: string;
  title: string;
  elements: PageContextElement[];
}

interface CdpAxNode {
  role?: { value?: string };
  name?: { value?: string };
  childIds?: string[];
  ignored?: boolean;
}

function flattenCdpAxTree(
  nodes: CdpAxNode[],
  rootId: string | undefined,
  out: PageContextElement[],
  maxElements: number,
): void {
  if (!rootId || out.length >= maxElements) return;
  const byId = new Map<string, CdpAxNode>();
  for (const node of nodes) {
    const id = (node as CdpAxNode & { nodeId?: string }).nodeId;
    if (id) byId.set(id, node);
  }

  const walk = (nodeId: string) => {
    if (out.length >= maxElements) return;
    const node = byId.get(nodeId);
    if (!node || node.ignored) {
      for (const childId of node?.childIds ?? []) walk(childId);
      return;
    }
    const role = node.role?.value?.toLowerCase();
    const name = node.name?.value?.trim();
    if (role && INTERACTIVE_A11Y_ROLES.has(role)) {
      out.push({
        role,
        name: name?.slice(0, 80) || undefined,
      });
    }
    for (const childId of node.childIds ?? []) walk(childId);
  };

  walk(rootId);
}

const GROUNDING_CTA_PATTERNS = [
  /book\s*a?\s*demo/i,
  /request\s*demo/i,
  /sign\s*in/i,
  /get\s*started/i,
  /contact\s*us/i,
  /register/i,
];

function prioritizeGroundingElements(
  elements: PageContextElement[],
  maxElements: number,
): PageContextElement[] {
  if (elements.length <= maxElements) return elements;
  const dialogsAlerts: PageContextElement[] = [];
  const cta: PageContextElement[] = [];
  const buttons: PageContextElement[] = [];
  const rest: PageContextElement[] = [];
  for (const el of elements) {
    if (el.role === "dialog" || el.role === "alert") dialogsAlerts.push(el);
    else if (GROUNDING_CTA_PATTERNS.some((p) => p.test(el.name ?? ""))) cta.push(el);
    else if (el.role === "button") buttons.push(el);
    else rest.push(el);
  }
  return [...dialogsAlerts, ...cta, ...buttons, ...rest].slice(0, maxElements);
}

function findCdpAxRoot(
  axNodes: Array<CdpAxNode & { nodeId?: string }>,
): (CdpAxNode & { nodeId?: string }) | undefined {
  return axNodes.find((n) => {
    const r = n.role?.value?.toLowerCase();
    return r === "rootwebarea" || r === "root" || r === "webarea";
  });
}

function elementDedupeKey(el: PageContextElement): string {
  return `${el.role}|${el.name ?? ""}|${el.href ?? ""}`;
}

function mergeGroundingElements(
  target: PageContextElement[],
  incoming: PageContextElement[],
  seen: Set<string>,
  limit: number,
): void {
  for (const el of incoming) {
    const key = elementDedupeKey(el);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(el);
    if (target.length >= limit) return;
  }
}

async function captureDomFallback(
  scope: LocatorScope,
  maxElements: number,
): Promise<PageContextElement[]> {
  return (await scope.evaluate((cap: number) => {
    const roles = new Set([
      "button",
      "link",
      "textbox",
      "checkbox",
      "combobox",
      "tab",
      "menuitem",
      "heading",
      "dialog",
      "alert",
      "switch",
      "slider",
      "gridcell",
      "img",
      "searchbox",
    ]);
    const out: Array<{ role: string; name?: string; href?: string }> = [];
    const sel =
      "a,button,input,textarea,select,[role],[aria-label],[placeholder]";
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const he = el as HTMLElement;
      const rect = he.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const role =
        he.getAttribute("role") ??
        (he.tagName === "BUTTON"
          ? "button"
          : he.tagName === "A"
            ? "link"
            : he.tagName === "INPUT"
              ? "textbox"
              : he.tagName === "TEXTAREA"
                ? "textbox"
                : "");
      if (!role || !roles.has(role.toLowerCase())) continue;
      const name =
        (he.innerText || he.getAttribute("aria-label") || "")
          .trim()
          .slice(0, 80) ||
        he.getAttribute("placeholder")?.trim().slice(0, 80) ||
        undefined;
      const href =
        he instanceof HTMLAnchorElement ? he.href || undefined : undefined;
      out.push({ role: role.toLowerCase(), name, href });
      if (out.length >= cap) break;
    }
    return out;
  }, maxElements)) as PageContextElement[];
}

async function captureDomFallbackFromAllFrames(
  page: Page,
  maxElements: number,
): Promise<PageContextElement[]> {
  const out: PageContextElement[] = [];
  const seen = new Set<string>();
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    const chunk = await captureDomFallback(frame, maxElements);
    mergeGroundingElements(out, chunk, seen, maxElements);
    if (out.length >= maxElements) break;
  }
  return out;
}

async function collectAxTreeElements(
  page: Page,
  collectLimit: number,
): Promise<PageContextElement[]> {
  const elements: PageContextElement[] = [];
  try {
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes?: Array<CdpAxNode & { nodeId?: string }>;
    };
    const axNodes = nodes ?? [];
    const root = findCdpAxRoot(axNodes);
    flattenCdpAxTree(axNodes, root?.nodeId, elements, collectLimit);
    if (elements.length > 0) {
      await enrichElementsWithLinkHrefs(page, elements);
    }
  } catch {
    // CDP accessibility tree unavailable for this page.
  }
  return elements;
}

async function collectGroundingElementsFromPage(
  page: Page,
  collectLimit: number,
  target: PageContextElement[],
  seen: Set<string>,
): Promise<void> {
  const axElements = await collectAxTreeElements(page, collectLimit);
  if (axElements.length > 0) {
    mergeGroundingElements(target, axElements, seen, collectLimit);
  } else {
    const domElements = await captureDomFallbackFromAllFrames(page, collectLimit);
    mergeGroundingElements(target, domElements, seen, collectLimit);
  }

  const iframeElements = await captureDomFallbackFromAllFrames(page, collectLimit);
  mergeGroundingElements(target, iframeElements, seen, collectLimit);
}

async function enrichElementsWithLinkHrefs(
  page: Page,
  elements: PageContextElement[],
): Promise<void> {
  const links = (await page.evaluate(() => {
    const out: Array<{ name: string; href: string }> = [];
    for (const el of Array.from(document.querySelectorAll("a[href]"))) {
      const he = el as HTMLAnchorElement;
      const rect = he.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const name = (he.innerText || he.getAttribute("aria-label") || "")
        .trim()
        .slice(0, 80);
      if (!name || !he.href) continue;
      out.push({ name, href: he.href });
    }
    return out;
  })) as Array<{ name: string; href: string }>;

  const used = new Set<number>();
  for (const el of elements) {
    if (el.role !== "link" || el.href || !el.name) continue;
    const idx = links.findIndex(
      (l, i) => !used.has(i) && l.name === el.name,
    );
    if (idx >= 0) {
      el.href = links[idx].href;
      used.add(idx);
    }
  }
}

/**
 * Accessibility-tree snapshot of interactive elements, used to ground
 * AI generation in semantic roles and labels. Never throws.
 */
export async function capturePageContext(
  url: string,
  maxElements = 60,
): Promise<PageContext | undefined> {
  let context: BrowserContext | undefined;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    attachPopupOverlayHandler(context);
    const page = await context.newPage();
    await page.goto(url, { timeout: 25000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.waitForTimeout(500);
    const title = await page.title();
    const elements: PageContextElement[] = [];
    const seen = new Set<string>();

    const collectLimit = Math.max(maxElements * 4, 200);

    for (const activePage of context.pages()) {
      if (activePage.isClosed()) continue;
      await collectGroundingElementsFromPage(activePage, collectLimit, elements, seen);
      if (elements.length >= collectLimit) break;
    }

    const capped = prioritizeGroundingElements(elements, maxElements);
    return { url, title, elements: capped };
  } catch {
    return undefined;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

function processKeyToDisplayName(processKey: string): string {
  return processKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("_");
}

function formatIstTimestamp(now = new Date()): { date: string; time: string } {
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const date = dateFmt.format(now);
  const time = timeFmt.format(now).replace(/:/g, "-");
  return { date, time };
}

async function resolveScreenshotFilename(
  ctx: RunCtx,
  now = new Date(),
): Promise<string> {
  const useCaseName = ctx.processKey
    ? processKeyToDisplayName(ctx.processKey)
    : ctx.runId;
  const { date, time } = formatIstTimestamp(now);
  const base = `${useCaseName}_Run_${date}_${time}_IST`.replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
  let file = `${base}.png`;
  let suffix = 2;
  while (
    await fs
      .access(path.join(SCREENSHOTS_DIR, file))
      .then(() => true)
      .catch(() => false)
  ) {
    file = `${base}_${suffix}.png`;
    suffix++;
  }
  return file;
}

async function captureScreenshot(
  page: Page,
  ctx: RunCtx,
  _label: string,
): Promise<string | undefined> {
  try {
    const file = await resolveScreenshotFilename(ctx);
    const target = path.join(SCREENSHOTS_DIR, file);
    await page.screenshot({ path: target, fullPage: false });
    return `/api/screenshots/${file}`;
  } catch (err) {
    console.error("[browser] screenshot failed:", (err as Error).message);
    return undefined;
  }
}
