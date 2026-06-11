import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { promises as fs } from "node:fs";
import {
  ALLOWED_EMAIL_DOMAIN,
  ALLOWED_ORIGIN,
  API_PORT,
  AUTH_ENABLED,
  LOGS_DIR,
  SCREENSHOTS_DIR,
} from "./config.ts";
import { authPreHandler, getUser } from "./auth.ts";
import { getRun, listRuns } from "./store.ts";
import { startNewRun, isRunActive, getActiveRun } from "./engine.ts";
import {
  generateBrowserAutomation,
  generateWorkflowFromPrompt,
  modifyWorkflow,
  recommendTestAssets,
} from "./ai.ts";
import { generateFakerRows } from "./faker.ts";
import {
  bulkUpsertCases,
  compilePlanToElementTests,
  findDataSetInPlan,
  getPlan,
  upsertPlan,
  type BulkCaseInput,
  type TestPlanFile,
} from "./plans.ts";
import {
  blankBpmnXml,
  canDeleteProcess,
  deleteProcess,
  ensureDirs,
  getProcess,
  listProcesses,
  renameProcess,
  upsertProcess,
  validateKey,
} from "./processes.ts";
import {
  buildTraceability,
  buildUseCaseSummaries,
  type TraceabilityView,
} from "./traceability.ts";
import { startTestRun, syncPlanToTags } from "./testRuns.ts";

export async function startServer() {
  const app = Fastify({ logger: { level: "info" } });
  const corsOrigin = parseAllowedOrigin(ALLOWED_ORIGIN);
  await app.register(cors, { origin: corsOrigin });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
  await ensureDirs();
  await app.register(fastifyStatic, {
    root: SCREENSHOTS_DIR,
    prefix: "/api/screenshots/",
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: LOGS_DIR,
    prefix: "/api/logs/",
    decorateReply: false,
  });

  app.addHook("onRequest", authPreHandler);

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/auth/config", async () => ({
    enabled: AUTH_ENABLED,
    domain: ALLOWED_EMAIL_DOMAIN ?? null,
  }));

  app.get("/api/auth/me", async (req) => ({ user: getUser(req) }));

  app.get("/", async (_req, reply) => {
    reply.type("text/html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QA Flow API</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           background: #0f172a; color: #e2e8f0; display: grid; place-items: center;
           min-height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 520px; padding: 32px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { color: #94a3b8; line-height: 1.6; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%;
           background: #10b981; margin-right: 8px; }
    code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <div class="card">
    <h1><span class="dot"></span>QA Flow API is running</h1>
    <p>This is the <strong>backend</strong> service. The visual app lives in the
       frontend (deployed separately on Vercel).</p>
    <p>Health check: <a href="/api/health"><code>/api/health</code></a><br/>
       Processes: <a href="/api/processes"><code>/api/processes</code></a></p>
  </div>
</body>
</html>`);
  });

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
      const actor = getUser(req);
      const saved = await upsertProcess({
        key: req.body.key,
        bpmnXml,
        tags,
        actor: actor
          ? { email: actor.email, name: actor.name }
          : undefined,
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
      const actor = getUser(req);
      const saved = await upsertProcess({
        key: req.params.key,
        bpmnXml: req.body.bpmnXml,
        tags: req.body.tags,
        actor: actor
          ? { email: actor.email, name: actor.name }
          : undefined,
      });
      return saved;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.patch<{ Params: { key: string }; Body: { name?: string } }>(
    "/api/processes/:key",
    async (req, reply) => {
      const name = req.body?.name;
      if (!name || !name.trim())
        return reply.code(400).send({ error: "name required" });
      try {
        const saved = await renameProcess(req.params.key, name);
        return saved;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete<{ Params: { key: string } }>(
    "/api/processes/:key",
    async (req, reply) => {
      try {
        const actor = getUser(req);
        const allowed = await canDeleteProcess(
          req.params.key,
          actor?.email ?? null,
        );
        if (!allowed) {
          return reply.code(403).send({
            error: "only the creator can delete this use case",
          });
        }
        await deleteProcess(req.params.key);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get<{ Params: { key: string } }>(
    "/api/processes/:key/plan",
    async (req, reply) => {
      const proc = await getProcess(req.params.key);
      if (!proc) return reply.code(404).send({ error: "not found" });
      const plan = await getPlan(req.params.key);
      return { plan };
    },
  );

  app.put<{ Params: { key: string }; Body: { plan: TestPlanFile } }>(
    "/api/processes/:key/plan",
    async (req, reply) => {
      try {
        const plan = await upsertPlan({
          ...req.body.plan,
          processKey: req.params.key,
        });
        const elementTests = compilePlanToElementTests(plan);
        const proc = await getProcess(req.params.key);
        if (!proc) return reply.code(404).send({ error: "not found" });
        const actor = getUser(req);
        await upsertProcess({
          key: req.params.key,
          bpmnXml: proc.bpmnXml,
          tags: { processKey: req.params.key, elementTests },
          actor: actor
            ? { email: actor.email, name: actor.name }
            : undefined,
        });
        return { plan, elementTests };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{
    Params: { key: string; nodeId: string };
    Body: {
      suiteId: string;
      scenarioId: string;
      cases: BulkCaseInput[];
    };
  }>(
    "/api/processes/:key/plan/nodes/:nodeId/cases",
    async (req, reply) => {
      try {
        const plan = await bulkUpsertCases(
          req.params.key,
          req.params.nodeId,
          req.body.suiteId,
          req.body.scenarioId,
          req.body.cases ?? [],
        );
        return { plan };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get<{ Params: { key: string } }>(
    "/api/processes/:key/plan/export",
    async (req, reply) => {
      const proc = await getProcess(req.params.key);
      if (!proc) return reply.code(404).send({ error: "not found" });
      const plan = await getPlan(req.params.key);
      return { plan, exportedAt: new Date().toISOString() };
    },
  );

  app.post<{ Params: { key: string }; Body: { plan: TestPlanFile } }>(
    "/api/processes/:key/plan/import",
    async (req, reply) => {
      try {
        const plan = await upsertPlan({
          ...req.body.plan,
          processKey: req.params.key,
        });
        const actor = getUser(req);
        await syncPlanToTags(
          req.params.key,
          actor ? { email: actor.email, name: actor.name } : undefined,
        );
        return { plan };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Params: { key: string } }>(
    "/api/processes/:key/plan/compile",
    async (req, reply) => {
      try {
        const actor = getUser(req);
        await syncPlanToTags(
          req.params.key,
          actor ? { email: actor.email, name: actor.name } : undefined,
        );
        const plan = await getPlan(req.params.key);
        return { elementTests: compilePlanToElementTests(plan) };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{
    Params: {
      key: string;
      nodeId: string;
      caseId: string;
      dataSetId: string;
    };
    Body: { count?: number; locale?: string };
  }>(
    "/api/processes/:key/plan/nodes/:nodeId/cases/:caseId/datasets/:dataSetId/generate",
    async (req, reply) => {
      try {
        const plan = await getPlan(req.params.key);
        const found = findDataSetInPlan(plan, req.params.dataSetId);
        if (!found) return reply.code(404).send({ error: "dataset not found" });
        const schema = found.dataSet.fakerSchema ?? {};
        const rows = await generateFakerRows({
          schema,
          count: req.body?.count ?? 5,
          locale: req.body?.locale,
        });
        found.dataSet.rows = rows;
        await upsertPlan(plan);
        return { rows };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{
    Body: {
      scope: {
        type: string;
        processKey: string;
        nodeId?: string;
        suiteId?: string;
        scenarioId?: string;
        caseId?: string;
      };
      environment?: string;
    };
  }>("/api/test-runs", async (req, reply) => {
    try {
      const scope = req.body?.scope;
      if (!scope?.processKey || !scope?.type) {
        return reply.code(400).send({ error: "scope.processKey and scope.type required" });
      }      const result = await startTestRun({
        scope: scope as Parameters<typeof startTestRun>[0]["scope"],
        environment: req.body?.environment,
        startedBy: getUser(req)?.email,
      });
      return reply.code(201).send(result);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { view?: string } }>(
    "/api/traceability",
    async (req) => {
      const view = (req.query.view ?? "workflow_to_case") as TraceabilityView;
      return buildTraceability(view);
    },
  );

  app.get("/api/usecases", async () => ({
    useCases: await buildUseCaseSummaries(),
  }));

  app.post<{ Body: { processKey: string; prompt: string } }>(
    "/api/ai/workflow",
    async (req, reply) => {
      try {
        validateKey(req.body.processKey);
        const result = await generateWorkflowFromPrompt(
          req.body.processKey,
          req.body.prompt,
        );
        return result;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{
    Body: { processKey: string; bpmnXml: string; instruction: string };
  }>("/api/ai/workflow/modify", async (req, reply) => {
    try {
      const result = await modifyWorkflow(
        req.body.processKey,
        req.body.bpmnXml,
        req.body.instruction,
      );
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{
    Body: {
      processKey: string;
      nodeId: string;
      nodeName?: string;
      bpmnXml: string;
      planSummary?: string;
    };
  }>("/api/ai/recommend", async (req, reply) => {
    try {
      const result = await recommendTestAssets(req.body);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{
    Body: {
      name: string;
      steps: Array<{ action: string; expectedResult?: string }>;
      startUrl?: string;
      inputs?: Array<{ name: string; value?: string }>;
      outputs?: Array<{ name: string; selector?: string }>;
    };
  }>("/api/ai/automation", async (req, reply) => {
    try {
      const steps = (req.body.steps ?? []).filter((s) => s && s.action?.trim());
      if (steps.length === 0) {
        return reply
          .code(400)
          .send({ error: "Add at least one test step before generating." });
      }
      const result = await generateBrowserAutomation({
        name: req.body.name ?? "Generated automation",
        steps,
        startUrl: req.body.startUrl?.trim() || undefined,
        inputs: req.body.inputs,
        outputs: req.body.outputs,
      });
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{
    Body?: { processKey?: string; environment?: string; tag?: string };
  }>("/api/runs", async (req, reply) => {
    const key = req.body?.processKey;
    if (!key) return reply.code(400).send({ error: "processKey required" });
    const proc = await getProcess(key);
    if (!proc)
      return reply.code(404).send({ error: `process not found: ${key}` });    const { runId, processInstanceId } = await startNewRun(key, {
      environment: req.body?.environment,
      tag: req.body?.tag,
      startedBy: getUser(req)?.email,
    });
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
      traceability?: Record<string, unknown>;
    }> = [];
    const resultIds =
      visited.length > 0 ? visited : Object.keys(run.results);
    for (const activityId of resultIds) {
      if (seen.has(activityId)) continue;
      seen.add(activityId);
      const r = run.results[activityId];
      activities.push({
        activityId,
        activityName: r?.traceability?.caseName ?? activityId,
        activityType: r?.traceability?.caseId ? "testCase" : "serviceTask",
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
        traceability: r?.traceability as Record<string, unknown> | undefined,
      });
    }
    const planActive =
      run.kind === "plan" && run.finishedAt === undefined;
    return { run, active: active || planActive, activities };
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
