import { promises as fs } from "node:fs";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { SCREENSHOTS_DIR } from "../config.ts";
import type { BrowserStep, BrowserTestDef } from "../tags.ts";

export interface BrowserStepResult {
  index: number;
  action: string;
  name?: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
  screenshotUrl?: string;
  durationMs: number;
}

export interface BrowserExecutionResult {
  passed: boolean;
  reasons: string[];
  durationMs: number;
  steps: BrowserStepResult[];
}

let sharedBrowser: Browser | undefined;
const browserSessions = new Map<string, BrowserSession>();
const SESSION_IDLE_MS = 2 * 60 * 1000;

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  closeTimer?: NodeJS.Timeout;
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
  const session = { context, page };
  browserSessions.set(ctx.runId, session);
  return session;
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

export async function runBrowserTest(
  test: BrowserTestDef,
  ctx: RunCtx,
): Promise<BrowserExecutionResult> {
  const overallStart = Date.now();
  const reasons: string[] = [];
  const steps: BrowserStepResult[] = [];
  let passed = true;

  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  const { page } = await getSession(ctx);

  let stepIndex = 0;
  try {
    for (const step of test.steps) {
      const result = await runStep(page, step, stepIndex, ctx);
      steps.push(result);
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
  };
}

async function runStep(
  page: Page,
  step: BrowserStep,
  index: number,
  ctx: RunCtx,
): Promise<BrowserStepResult> {
  const start = Date.now();
  const timeout = step.timeoutMs ?? 20000;
  const base: BrowserStepResult = {
    index,
    action: step.action,
    name: step.name,
    status: "passed",
    durationMs: 0,
  };
  try {
    switch (step.action) {
      case "goto":
        if (!step.url) throw new Error("goto requires 'url'");
        await page.goto(step.url, { timeout, waitUntil: "domcontentloaded" });
        break;
      case "click":
        if (!step.selector) throw new Error("click requires 'selector'");
        await page.locator(step.selector).first().click({ timeout });
        break;
      case "tryClick":
        if (!step.selector) throw new Error("tryClick requires 'selector'");
        try {
          await page
            .locator(step.selector)
            .first()
            .click({ timeout: Math.min(timeout, 5000) });
        } catch (err) {
          if (!step.optional) throw err;
          return {
            ...base,
            status: "skipped",
            message: `optional click skipped: ${(err as Error).message.split("\n")[0]}`,
            durationMs: Date.now() - start,
          };
        }
        break;
      case "fill":
        if (!step.selector || step.value === undefined)
          throw new Error("fill requires 'selector' and 'value'");
        await page.locator(step.selector).first().fill(step.value, { timeout });
        break;
      case "press":
        if (!step.selector || !step.value)
          throw new Error("press requires 'selector' and 'value' (key)");
        await page.locator(step.selector).first().press(step.value, { timeout });
        break;
      case "waitForSelector":
        if (!step.selector) throw new Error("waitForSelector requires 'selector'");
        await page.locator(step.selector).first().waitFor({ timeout });
        break;
      case "waitForTimeout":
        await page.waitForTimeout(step.timeoutMs ?? 1000);
        break;
      case "waitForLoadState":
        await page.waitForLoadState(step.state ?? "networkidle", { timeout });
        break;
      case "screenshot": {
        const url = await captureScreenshot(
          page,
          ctx,
          step.name ?? `step-${index}`,
        );
        return {
          ...base,
          status: "passed",
          screenshotUrl: url,
          durationMs: Date.now() - start,
        };
      }
      case "assertContains": {
        if (!step.text) throw new Error("assertContains requires 'text'");
        const body = await page.locator("body").innerText({ timeout });
        const haystack = step.ignoreCase ? body.toLowerCase() : body;
        const needle = step.ignoreCase ? step.text.toLowerCase() : step.text;
        if (!haystack.includes(needle)) {
          throw new Error(
            `page body does not contain "${step.text}" (ignoreCase=${!!step.ignoreCase}). First 400 chars: ${body.slice(0, 400)}`,
          );
        }
        break;
      }
      case "assertVisible": {
        if (!step.selector) throw new Error("assertVisible requires 'selector'");
        const visible = await page
          .locator(step.selector)
          .first()
          .isVisible({ timeout });
        if (!visible) throw new Error(`selector ${step.selector} not visible`);
        break;
      }
      default: {
        const exhaustive: never = step.action as never;
        throw new Error(`unknown action: ${exhaustive}`);
      }
    }
    return { ...base, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ...base,
      status: "failed",
      message: (err as Error).message.split("\n").slice(0, 4).join(" | "),
      durationMs: Date.now() - start,
    };
  }
}

async function captureScreenshot(
  page: Page,
  ctx: RunCtx,
  label: string,
): Promise<string | undefined> {
  try {
    const safe = label.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60);
    const ts = Date.now();
    const file = `${ctx.runId}_${ctx.activityId}_${ts}_${safe}.png`;
    const target = path.join(SCREENSHOTS_DIR, file);
    await page.screenshot({ path: target, fullPage: false });
    return `/api/screenshots/${file}`;
  } catch (err) {
    console.error("[browser] screenshot failed:", (err as Error).message);
    return undefined;
  }
}
