# QA Flow

A BPMN-driven QA automation platform — solution architects model business processes as BPMN, QA engineers tag test cases against BPMN elements, and an engine executes the model and overlays pass/fail directly on the diagram.

This repository is the **walking skeleton**: every architectural layer exists end-to-end at minimum thickness, ready to thicken in later phases.

## Quick start

You need only **Node.js 22+** (uses native TypeScript via `--experimental-strip-types`). No Docker, no Java, no Camunda server, no internet.

```bash
# 1. install everything
npm run install:all

# 2. run backend + frontend together
npm run dev

# 3. open http://localhost:5173
#    Click "Start Run". Watch the BPMN nodes light up.
```

The backend runs on `:4000`, the frontend dev server on `:5173`.

## What you'll see

The BPMN diagram **Order Fulfillment** renders in the canvas. Click **Start Run** and the engine executes:

1. **Create Order** — `POST /mock/orders` → expect 200 + `{orderId: 42, status: "created"}`
2. **Verify Order Exists** — `GET /mock/orders/42` → expect 200 + `{orderId: 42, status: "active"}`
3. **Gateway: Order found?** — branches on the boolean produced by the verify step
4. **PASS path** → **Send Confirmation** → **End OK**
5. **FAIL path** → **Log Failure** → **End Failed**

Each tagged element lights up green (passed), red (failed), amber (running), or indigo (executed without a test) on the diagram. The side panel shows per-activity status, duration, message, and evidence (request/response).

To see the **failure** path, edit `bpmn/tags.json` and change the `verify_order` expected jsonPath (e.g. expect `"status": "shipped"`) — re-run, and the engine will route to `log_failure`.

## Architecture

```
                     bpmn/order-fulfillment.bpmn   bpmn/tags.json
                                  \                      /
                                   \                    /
                                    v                  v
+--------+   /api/process    +---------------+   loads   +-----------------+
| React  |<-----------------|  Fastify API  |---------->| Embedded BPMN   |
| + bpmn-|   /api/runs       +---------------+           | engine          |
| js     |---------------->                              | (bpmn-engine)   |
+--------+                                               +--------+--------+
    ^                                                             |
    |  /api/runs/:id (polled)                                     | per-element
    |                                                             v
    |                              +------------------+    +----------------+
    +------------------------------|  Run/Result      |<---| HTTP test      |
                                   |  store (JSON)    |    | runner (undici)|
                                   +------------------+    +-------+--------+
                                                                   |
                                                                   v
                                                          +------------------+
                                                          |  /mock/* built-  |
                                                          |  in endpoints    |
                                                          +------------------+
```

- **BPMN model** (`bpmn/order-fulfillment.bpmn`) — vanilla BPMN 2.0 with `camunda:type="external"` service tasks. Renderable in any BPMN tool (Camunda Modeler, bpmn-js, Lucid via shape convention).
- **Tags** (`bpmn/tags.json`) — maps each BPMN service-task `id` to an HTTP test definition (method, URL, headers, body, expected status + jsonPath assertions, and which engine variable to set from the result). In Phase 2 this becomes the tagging UI's store.
- **Engine** (`backend/src/engine.ts`) — embedded [`bpmn-engine`](https://github.com/paed01/bpmn-engine) (MIT, Node) with the `ServiceTask` element overridden so each tagged task runs through our HTTP test runner. The engine handles tokens, gateways, sequence flows, and the lifecycle events the UI consumes.
- **HTTP test runner** (`backend/src/workers/http-worker.ts`) — pure function: takes a test definition, executes the request, asserts status + jsonPath, returns `{passed, status, bodyPreview, reasons, durationMs}`. In Phase 2 this becomes one of many runner types (Playwright, DB, Kafka).
- **Run store** (`backend/src/store.ts`) — JSON file (`data/runs.json`) of run records keyed by `runId`. Each record holds per-activity status + evidence. Swap to Postgres + S3 in Phase 3.
- **Fastify API** (`backend/src/server.ts`) — three endpoints (`/api/process`, `POST /api/runs`, `GET /api/runs/:id`) plus the `/mock/*` endpoints used by the demo so the skeleton runs offline.
- **Frontend** (`frontend/`) — React + Vite + [bpmn-js](https://bpmn.io/toolkit/bpmn-js/) `NavigatedViewer`. Renders the BPMN, starts runs, polls run state, applies CSS markers (`qa-passed`, `qa-failed`, etc.) to each visited element so the diagram becomes a live execution trace.

## Why an embedded engine (and not Camunda) for the walking skeleton

The plan called for Camunda/Flowable/Zeebe. The walking skeleton ships with `bpmn-engine` because:

- Zero infra to start (no Docker, no Java, no Postgres).
- Same BPMN file — service tasks use `camunda:type="external" camunda:topic="http.api"` exactly as Camunda expects, so the BPMN is engine-portable.
- Same architectural seams — the "worker" is a pure function; replacing the embedded engine with Camunda 7's external-task polling client only changes `engine.ts`.

When to swap in real Camunda/Flowable: when you need durable processes (state survives restart), parallel run scale (1000s of instances), language-agnostic workers (Java/Python/etc), or BPMN features bpmn-engine doesn't cover (e.g. DMN, complex correlation).

## Layout

```
QA Flow/
  package.json              orchestration (install:all, dev)
  bpmn/
    order-fulfillment.bpmn  the process model
    tags.json               element-id -> test definition
  backend/
    package.json
    src/
      index.ts              entrypoint
      server.ts             Fastify API + /mock/* endpoints
      engine.ts             embedded bpmn-engine + ServiceTask override
      workers/http-worker.ts  the HTTP test runner (pure function)
      tags.ts               loads & caches tags.json
      store.ts              JSON-file run store
      config.ts             paths, ports
  frontend/
    package.json
    src/
      App.tsx               page shell + side panel
      BpmnCanvas.tsx        bpmn-js viewer + overlay markers
      api.ts                typed fetch helpers
      styles.css            including .qa-{passed,failed,running,executed} markers
      main.tsx
  data/
    runs.json               (created on first run)
```

## What's intentionally NOT in the walking skeleton

- **Lucid import** — Phase 0 spike (see plan). The model is hand-authored for now. Importer plugs in behind `POST /processes` (not yet exposed).
- **Tagging UI** — Phase 2. `tags.json` is the placeholder; the schema is already what the UI will write.
- **Auth / multi-tenancy / SSO** — Phase 3.
- **TestRail / Xray federation** — Phase 2 (replace local `tags.json` with a federated registry).
- **Evidence store** — currently inline in `runs.json`; Phase 2 moves bodies/screenshots/HAR to S3/MinIO.
- **Playwright UI worker / DB worker / Kafka worker** — Phase 2 (additional runner functions, same plug pattern as `http-worker.ts`).
- **Durable engine / horizontal scaling** — Phase 3 (swap embedded engine for Flowable or Camunda 7 Community).
- **CI triggers / Slack & Jira notifications** — Phase 3.

Every one of these plugs into a seam already present in this skeleton.

## Run sanity check (without the UI)

```bash
# in one terminal
npm run dev:backend

# in another
curl -sX POST http://localhost:4000/api/runs
# -> {"runId":"...","processInstanceId":"..."}

curl -s http://localhost:4000/api/runs/<runId> | jq
```
