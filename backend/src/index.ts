import { startServer } from "./server.ts";

async function main() {
  await startServer();
}

main().catch((err) => {
  console.error("[startup] failed:", err);
  process.exit(1);
});
