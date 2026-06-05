import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, "../..");
export const BPMN_DIR = process.env.BPMN_DIR ?? path.join(ROOT, "bpmn");
export const TAGS_DIR = path.join(BPMN_DIR, "tags");
export const PLANS_DIR = path.join(BPMN_DIR, "plans");
export const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, "data");
export const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");
export const SCRIPTS_DIR = path.join(DATA_DIR, "scripts");
export const LOGS_DIR = path.join(DATA_DIR, "logs");
export const RUNS_FILE = path.join(DATA_DIR, "runs.json");

export const API_PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
export const API_BASE_URL =
  process.env.API_BASE_URL ?? `http://localhost:${API_PORT}`;

export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN;
export const AUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID);

export function bpmnPathFor(key: string): string {
  return path.join(BPMN_DIR, `${key}.bpmn`);
}

export function tagsPathFor(key: string): string {
  return path.join(TAGS_DIR, `${key}.json`);
}

export function planPathFor(key: string): string {
  return path.join(PLANS_DIR, `${key}.json`);
}

export const PROCESS_KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;
