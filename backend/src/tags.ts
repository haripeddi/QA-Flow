import { promises as fs } from "node:fs";
import { TAGS_FILE } from "./config.ts";

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

export interface TagsFile {
  processKey: string;
  elementTests: Record<string, HttpTestDef>;
}

let cache: TagsFile | undefined;

export async function loadTags(): Promise<TagsFile> {
  if (cache) return cache;
  const raw = await fs.readFile(TAGS_FILE, "utf8");
  cache = JSON.parse(raw) as TagsFile;
  return cache;
}

export function clearTagsCache() {
  cache = undefined;
}
