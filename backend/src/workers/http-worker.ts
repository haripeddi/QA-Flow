import { request } from "undici";
import { JSONPath } from "jsonpath-plus";
import type { HttpTestDef } from "../tags.ts";
import { API_BASE_URL } from "../config.ts";

export interface ExecutionResult {
  passed: boolean;
  status: number;
  bodyPreview: string;
  durationMs: number;
  reasons: string[];
}

export async function runHttpTest(test: HttpTestDef): Promise<ExecutionResult> {
  const start = Date.now();
  const reasons: string[] = [];
  const { request: req, expect } = test;
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  let body: string | undefined;
  if (req.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  let status = 0;
  let text = "";
  try {
    const res = await request(resolveUrl(req.url), {
      method: req.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
      headers,
      body,
    });
    status = res.statusCode;
    text = await res.body.text();
  } catch (err) {
    return {
      passed: false,
      status: 0,
      bodyPreview: "",
      durationMs: Date.now() - start,
      reasons: [`network error: ${(err as Error).message}`],
    };
  }
  let passed = true;
  if (expect.status !== undefined && status !== expect.status) {
    passed = false;
    reasons.push(`expected status ${expect.status}, got ${status}`);
  }
  if (expect.jsonPath) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      passed = false;
      reasons.push("response body is not valid JSON");
      json = undefined;
    }
    if (json !== undefined) {
      for (const [pathExpr, expected] of Object.entries(expect.jsonPath)) {
        const matches = JSONPath({ path: pathExpr, json });
        const actual = matches?.[0];
        if (!deepEqual(actual, expected)) {
          passed = false;
          reasons.push(
            `jsonPath ${pathExpr}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          );
        }
      }
    }
  }
  return {
    passed,
    status,
    bodyPreview: text.slice(0, 500),
    durationMs: Date.now() - start,
    reasons,
  };
}

function resolveUrl(url: string): string {
  return url.replaceAll("{{BASE_URL}}", API_BASE_URL);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}
