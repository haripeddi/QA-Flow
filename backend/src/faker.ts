import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../scripts/faker_gen.py");

export async function generateFakerRows(input: {
  schema: Record<string, string>;
  count: number;
  locale?: string;
}): Promise<Record<string, unknown>[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn("python3", ["-u", SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `faker_gen exited ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { rows: Record<string, unknown>[] };
        resolve(parsed.rows ?? []);
      } catch (e) {
        reject(new Error(`invalid faker output: ${(e as Error).message}`));
      }
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}
