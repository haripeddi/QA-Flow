import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LOGS_DIR, SCRIPTS_DIR } from "../config.ts";
import type { ScriptTestDef } from "../tags.ts";

export interface ScriptResult {
  passed: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  reasons: string[];
  parsedResult?: ParsedQaResult;
  logUrl?: string;
}

export interface ParsedQaResult {
  message?: string;
  setVariables?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

const RESULT_SENTINEL = "##QA_RESULT##";
const MAX_OUTPUT_BYTES = 64 * 1024;

interface RunCtx {
  runId: string;
  activityId: string;
  processKey: string;
  variables: Record<string, unknown>;
}

interface InterpreterSpec {
  command: string;
  args: (file: string) => string[];
  extension: string;
}

const SPECS: Record<ScriptTestDef["type"], () => Promise<InterpreterSpec>> = {
  "script.python": pythonSpec,
};

let cachedPython: string | null | undefined;

async function pythonSpec(): Promise<InterpreterSpec> {
  if (cachedPython === undefined) {
    cachedPython = (await which("python3")) ?? (await which("python")) ?? null;
  }
  if (!cachedPython) {
    throw new Error(
      "python3 not found on PATH; install Python 3 to use script.python tests",
    );
  }
  return {
    command: cachedPython,
    args: (file: string) => ["-u", file],
    extension: "py",
  };
}

async function which(cmd: string): Promise<string | null> {
  return await new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", `command -v ${cmd}`]);
    let out = "";
    child.stdout.on("data", (b) => (out += b.toString()));
    child.on("close", (code) => {
      if (code === 0 && out.trim()) resolve(out.trim());
      else resolve(null);
    });
    child.on("error", () => resolve(null));
  });
}

export async function runScriptTest(
  def: ScriptTestDef,
  ctx: RunCtx,
): Promise<ScriptResult> {
  const start = Date.now();
  const spec = await SPECS[def.type]();
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });
  const safeAct = ctx.activityId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const file = path.join(
    SCRIPTS_DIR,
    `${ctx.runId}-${safeAct}.${spec.extension}`,
  );
  await fs.writeFile(file, def.code ?? "", "utf8");

  const userVars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx.variables ?? {})) {
    if (!k.startsWith("__")) userVars[k] = v;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(def.env ?? {}),
    QA_PROCESS_KEY: ctx.processKey,
    QA_ACTIVITY_ID: ctx.activityId,
    QA_RUN_ID: ctx.runId,
    QA_VARS: JSON.stringify(userVars),
  };

  await fs.mkdir(LOGS_DIR, { recursive: true });
  const safeName = `${ctx.runId}_${safeAct}_${Date.now()}`;
  const logFile = path.join(LOGS_DIR, `${safeName}.log`);
  const logUrl = `/api/logs/${safeName}.log`;

  const timeoutMs = Math.max(1000, Math.min(def.timeoutMs ?? 30_000, 600_000));

  return await new Promise<ScriptResult>((resolve) => {
    const child = spawn(spec.command, spec.args(file), {
      env,
      cwd: SCRIPTS_DIR,
    });
    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBuf.length < MAX_OUTPUT_BYTES) {
        stdoutBuf += chunk.toString();
        if (stdoutBuf.length > MAX_OUTPUT_BYTES) {
          stdoutBuf = stdoutBuf.slice(0, MAX_OUTPUT_BYTES);
          stdoutTruncated = true;
        }
      } else {
        stdoutTruncated = true;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < MAX_OUTPUT_BYTES) {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > MAX_OUTPUT_BYTES) {
          stderrBuf = stderrBuf.slice(0, MAX_OUTPUT_BYTES);
          stderrTruncated = true;
        }
      } else {
        stderrTruncated = true;
      }
    });

    const finalize = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      const stdout =
        stdoutBuf + (stdoutTruncated ? "\n…[stdout truncated]…" : "");
      const stderr =
        stderrBuf + (stderrTruncated ? "\n…[stderr truncated]…" : "");
      const parsedResult = parseQaResult(stdout);
      const reasons: string[] = [];
      let passed = !timedOut && exitCode === 0;
      if (timedOut) reasons.push(`timed out after ${timeoutMs}ms`);
      else if (exitCode !== 0)
        reasons.push(
          `process exited with code ${exitCode}${signal ? ` (signal ${signal})` : ""}`,
        );
      if (parsedResult?.message) reasons.push(parsedResult.message);
      const durationMs = Date.now() - start;
      const logText = [
        `=== QA Flow script run ===`,
        `process : ${ctx.processKey}`,
        `activity: ${ctx.activityId}`,
        `run     : ${ctx.runId}`,
        `started : ${new Date(start).toISOString()}`,
        `duration: ${durationMs}ms`,
        `exitCode: ${exitCode}${signal ? ` (signal ${signal})` : ""}`,
        `result  : ${passed ? "PASS" : "FAIL"}`,
        ``,
        `--- stdout ---`,
        stdout || "(empty)",
        ``,
        `--- stderr ---`,
        stderr || "(empty)",
        ``,
      ].join("\n");
      void fs.writeFile(logFile, logText, "utf8").catch(() => {});
      resolve({
        passed,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs,
        timedOut,
        reasons,
        parsedResult,
        logUrl,
      });
    };

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        passed: false,
        exitCode: null,
        signal: null,
        stdout: stdoutBuf,
        stderr: stderrBuf + `\nfailed to spawn ${spec.command}: ${err.message}`,
        durationMs: Date.now() - start,
        timedOut: false,
        reasons: [`failed to spawn ${spec.command}: ${err.message}`],
      });
    });
    child.on("close", (code, signal) => finalize(code, signal));
  });
}

function parseQaResult(stdout: string): ParsedQaResult | undefined {
  let last: ParsedQaResult | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf(RESULT_SENTINEL);
    if (idx < 0) continue;
    const json = line.slice(idx + RESULT_SENTINEL.length).trim();
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as ParsedQaResult;
      if (parsed && typeof parsed === "object") last = parsed;
    } catch {}
  }
  return last;
}
