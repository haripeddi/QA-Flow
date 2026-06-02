import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, "../..");
export const BPMN_DIR = path.join(ROOT, "bpmn");
export const DATA_DIR = path.join(ROOT, "data");
export const RUNS_FILE = path.join(DATA_DIR, "runs.json");

export const BPMN_FILE = path.join(BPMN_DIR, "order-fulfillment.bpmn");
export const TAGS_FILE = path.join(BPMN_DIR, "tags.json");

export const CAMUNDA_BASE_URL =
  process.env.CAMUNDA_BASE_URL ?? "http://localhost:8080/engine-rest";
export const API_PORT = Number(process.env.API_PORT ?? 4000);
export const WORKER_ID = process.env.WORKER_ID ?? "qa-flow-worker-1";
export const WORKER_POLL_TOPICS = ["http.api"];
export const WORKER_LOCK_MS = 30_000;
export const WORKER_POLL_INTERVAL_MS = 1000;
