import { promises as fs } from "node:fs";
import { tagsPathFor } from "./config.ts";

export interface HttpExpectation {
  status?: number;
  jsonPath?: Record<string, unknown>;
}

export interface HttpRequestDef {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpTestDef {
  name: string;
  type: "http.api";
  request: HttpRequestDef;
  expect: HttpExpectation;
  setVariables?: Record<string, string>;
}

export interface BrowserStep {
  action:
    | "goto"
    | "click"
    | "fill"
    | "press"
    | "waitForSelector"
    | "waitForTimeout"
    | "waitForLoadState"
    | "screenshot"
    | "assertContains"
    | "assertVisible"
    | "tryClick";
  selector?: string;
  url?: string;
  value?: string;
  state?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  name?: string;
  text?: string;
  ignoreCase?: boolean;
  optional?: boolean;
}

export interface BrowserTestDef {
  name: string;
  type: "browser.playwright";
  steps: BrowserStep[];
  setVariables?: Record<string, string>;
}

export interface ScriptTestDef {
  name: string;
  type: "script.python";
  code: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export type TestDef = HttpTestDef | BrowserTestDef | ScriptTestDef;

export interface TagsFile {
  processKey: string;
  elementTests: Record<string, TestDef>;
}

const cache = new Map<string, TagsFile>();

export async function loadTags(processKey: string): Promise<TagsFile> {
  const cached = cache.get(processKey);
  if (cached) return cached;
  try {
    const raw = await fs.readFile(tagsPathFor(processKey), "utf8");
    const parsed = JSON.parse(raw) as TagsFile;
    cache.set(processKey, parsed);
    return parsed;
  } catch {
    const empty: TagsFile = { processKey, elementTests: {} };
    cache.set(processKey, empty);
    return empty;
  }
}

export function clearTagsCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
