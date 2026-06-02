import Fastify from "fastify";
import cors from "@fastify/cors";
import { promises as fs } from "node:fs";
import { API_PORT, BPMN_FILE } from "./config.ts";
import { loadTags } from "./tags.ts";
import { getRun, listRuns } from "./store.ts";
import { startNewRun, isRunActive, getActiveRun } from "./engine.ts";

export async function startServer() {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true }));

  app.post("/mock/orders", async (req) => {
    const body = (req.body ?? {}) as { orderId?: number };
    return { orderId: body.orderId ?? 42, status: "created" };
  });
  app.get<{ Params: { id: string } }>("/mock/orders/:id", async (req) => {
    return { orderId: Number(req.params.id), status: "active" };
  });
  app.post("/mock/confirmations", async (_req, reply) => {
    reply.code(200);
    return { ok: true };
  });
  app.post("/mock/failures", async (_req, reply) => {
    reply.code(200);
    return { ok: true, logged: true };
  });

  app.get("/api/process", async () => {
    const xml = await fs.readFile(BPMN_FILE, "utf8");
    const tags = await loadTags();
    return { processKey: tags.processKey, bpmnXml: xml, tags };
  });

  app.post("/api/runs", async () => {
    const { runId, processInstanceId } = await startNewRun();
    return { runId, processInstanceId };
  });

  app.get("/api/runs", async () => ({ runs: await listRuns() }));

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const run = await getRun(req.params.id);
    if (!run) return reply.code(404).send({ error: "run not found" });

    const active = isRunActive(req.params.id);
    const visited = getActiveRun(req.params.id)?.visited ?? [];
    const seen = new Set<string>();
    const activities: Array<{
      activityId: string;
      activityName: string | null;
      activityType: string;
      startTime: string;
      endTime: string | null;
      durationInMillis: number | null;
      status: "pending" | "running" | "passed" | "failed" | "executed";
      message?: string;
      evidence?: Record<string, unknown>;
    }> = [];
    for (const activityId of visited) {
      if (seen.has(activityId)) continue;
      seen.add(activityId);
      const r = run.results[activityId];
      activities.push({
        activityId,
        activityName: r ? activityId : activityId,
        activityType: r ? "serviceTask" : "executed",
        startTime: r?.startedAt ?? run.startedAt,
        endTime: r?.finishedAt ?? null,
        durationInMillis:
          r?.startedAt && r?.finishedAt
            ? new Date(r.finishedAt).getTime() -
              new Date(r.startedAt).getTime()
            : null,
        status: r?.status ?? "executed",
        message: r?.message,
        evidence: r?.evidence,
      });
    }
    return { run, active, activities };
  });

  await app.listen({ port: API_PORT, host: "0.0.0.0" });
  app.log.info(`API listening on http://localhost:${API_PORT}`);
}
