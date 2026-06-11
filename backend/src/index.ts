import { fileURLToPath } from "node:url";
import path from "node:path";
import { startServer } from "./server.ts";

// Best-effort load of a local .env (e.g. OPENAI_API_KEY) without a hard dependency.
// Resolve relative to this file so it works regardless of the process cwd.
const loadEnvFile = (process as unknown as {
  loadEnvFile?: (path?: string) => void;
}).loadEnvFile;
if (loadEnvFile) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.join(here, "..", ".env"), path.join(process.cwd(), ".env")]) {
    try {
      loadEnvFile(p);
      break;
    } catch {
      /* try next candidate */
    }
  }
}

async function main() {
  await startServer();
}

main().catch((err) => {
  console.error("[startup] failed:", err);
  process.exit(1);
});
