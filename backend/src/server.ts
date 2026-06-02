import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { promises as fs } from "node:fs";
import {
  ALLOWED_ORIGIN,
  API_PORT,
  SCREENSHOTS_DIR,
} from "./config.ts";
import { getRun, listRuns } from "./store.ts";
import { startNewRun, isRunActive, getActiveRun } from "./engine.ts";
import {
  blankBpmnXml,
  deleteProcess,
  ensureDirs,
  getProcess,
  listProcesses,
  upsertProcess,
  validateKey,
} from "./processes.ts";

export async function startServer() {
  const app = Fastify({ logger: { level: "info" } });
  const corsOrigin = parseAllowedOrigin(ALLOWED_ORIGIN);
  await app.register(cors, { origin: corsOrigin });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  await ensureDirs();
  await app.register(fastifyStatic, {
    root: SCREENSHOTS_DIR,
    prefix: "/api/screenshots/",
    decorateReply: false,
  });

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

  app.get("/api/processes", async () => ({
    processes: await listProcesses(),
  }));

  app.get<{ Params: { key: string } }>(
    "/api/processes/:key",
    async (req, reply) => {
      const proc = await getProcess(req.params.key);
      if (!proc) return reply.code(404).send({ error: "not found" });
      return proc;
    },
  );

  app.post<{
    Body: {
      key: string;
      name?: string;
      sourceKey?: string;
    };
  }>("/api/processes", async (req, reply) => {
    try {
      validateKey(req.body.key);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const existing = await getProcess(req.body.key);
    if (existing)
      return reply.code(409).send({ error: "process key already exists" });

    let bpmnXml: string;
    let tags = { processKey: req.body.key, elementTests: {} as Record<string, unknown> };
    if (req.body.sourceKey) {
      const src = await getProcess(req.body.sourceKey);
      if (!src)
        return reply.code(404).send({ error: "sourceKey not found" });
      bpmnXml = src.bpmnXml
        .replace(/id="Definitions_[^"]+"/, `id="Definitions_${req.body.key}"`)
        .replace(
          /<bpmn:process[^>]*\bid="[^"]+"/,
          `<bpmn:process id="${req.body.key}"`,
        )
        .replace(
          /bpmnElement="[^"]+"(\s*>\s*<bpmndi:BPMNShape)/m,
          (_m, rest) => `bpmnElement="${req.body.key}"${rest}`,
        );
      tags = {
        processKey: req.body.key,
        elementTests: src.tags.elementTests as Record<string, unknown>,
      };
    } else {
      bpmnXml = blankBpmnXml(req.body.key, req.body.name ?? req.body.key);
    }
    try {
      const saved = await upsertProcess({
        key: req.body.key,
        bpmnXml,
        tags,
      });
      return reply.code(201).send(saved);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.put<{
    Params: { key: string };
    Body: { bpmnXml: string; tags: { processKey: string; elementTests: Record<string, unknown> } };
  }>("/api/processes/:key", async (req, reply) => {
    try {
      const saved = await upsertProcess({
        key: req.params.key,
        bpmnXml: req.body.bpmnXml,
        tags: req.body.tags,
      });
      return saved;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete<{ Params: { key: string } }>(
    "/api/processes/:key",
    async (req, reply) => {
      try {
        await deleteProcess(req.params.key);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Body?: { processKey?: string } }>(
    "/api/runs",
    async (req, reply) => {
      const key = req.body?.processKey;
      if (!key) return reply.code(400).send({ error: "processKey required" });
      const proc = await getProcess(key);
      if (!proc)
        return reply.code(404).send({ error: `process not found: ${key}` });
      const { runId, processInstanceId } = await startNewRun(key);
      return { runId, processInstanceId };
    },
  );

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
        activityName: activityId,
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

function parseAllowedOrigin(
  raw: string | undefined,
): boolean | string | RegExp | (string | RegExp)[] {
  if (!raw || raw === "*") return true;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  const mapped = list.map((entry) => {
    if (entry.startsWith("/") && entry.endsWith("/")) {
      return new RegExp(entry.slice(1, -1));
    }
    return entry;
  });
  return mapped.length === 1 ? mapped[0] : mapped;
}
