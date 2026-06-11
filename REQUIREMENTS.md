# QA Flow — Project Requirements & Context

> Reusable context document. Paste or `@`-reference this file at the start of a
> chat so the assistant has full project context without re-exploring the codebase.
> Last updated: 2026-06-08 (adds AI agent execution + node-drawer UX refresh).

---

## 1. Purpose

QA Flow is a **plug-and-play QA automation platform with BPMN-driven workflow
execution**, aimed at an engineering org that wants:

- **Solution architects** to design business processes as **BPMN 2.0** diagrams.
- **QA engineers** to **tag test cases** against individual BPMN elements (nodes).
- A **visual run-trace engine** that executes the model and overlays
  pass/fail/running status directly on the diagram.
- The ability to author test steps as **HTTP calls, browser (Playwright) flows,
  or inline Python snippets**, with detailed logs and screenshots.

It has since grown into a **Test Planning & Traceability Suite** with a use-case
landing page, hierarchical test authoring, run generation, and traceability
metrics.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, `react-router-dom` 6, `bpmn-js` 17 (modeler + viewer), `xlsx` (SheetJS) |
| Backend | Node.js (TS via `--experimental-strip-types`), Fastify 4 |
| Workflow engine | Embedded `bpmn-engine` (paed01), `camunda-bpmn-moddle` |
| Test workers | `undici` (HTTP), `playwright` (browser), child-process Python (script) |
| Auth | Google Identity Services (frontend) + `google-auth-library` (backend ID-token verify) |
| AI assist | `openai` SDK (copilot / recommend endpoints) |
| Data | Faker-style generation (`faker.ts`); persistence is **flat JSON files** (no DB) |
| Deploy | Frontend → Vercel; Backend → Hugging Face Spaces (Docker SDK) |

**Runtime requirement:** Node.js 22+ (uses native TS strip-types). Browser tests
use Playwright with `channel: "chrome"` (no separate browser download).

---

## 3. Repository Layout

```
QA Flow/
  package.json              # orchestration (install:all, dev)
  Dockerfile                # Hugging Face Spaces image (backend)
  README.md                 # original "walking skeleton" doc
  DEPLOY.md                 # deployment notes
  REQUIREMENTS.md           # this file

  bpmn/                     # all persisted state lives here (flat files)
    <key>.bpmn              # BPMN 2.0 XML, one per use case (process)
    tags/<key>.json         # element-id -> executable test definition
    plans/<key>.json        # hierarchical test plan (suites/scenarios/cases)
    meta/<key>.json         # ownership: { createdBy, createdByName, createdAt }

  backend/src/
    index.ts                # entrypoint; loads backend/.env via process.loadEnvFile
    server.ts               # Fastify routes + /mock/* demo endpoints
    config.ts               # paths, ports, env vars
    engine.ts               # embedded bpmn-engine + ServiceTask override (startNewRun)
    processes.ts            # CRUD for BPMN files + meta/ownership helpers
    plans.ts                # test plan model + compile-to-tags
    tags.ts                 # loads/caches tags/<key>.json
    testRuns.ts             # plan-scoped run execution; syncPlanToTags;
                            #   ensureAgentExecutables (NL->Playwright at run time)
    store.ts                # data/runs.json run record store
    traceability.ts         # buildUseCaseSummaries + buildTraceability
    auth.ts                 # Google token verify, domain gate, authPreHandler
    ai.ts                   # OpenAI workflow gen / modify / recommend +
                            #   generateBrowserAutomation (NL steps -> browser.playwright)
    faker.ts                # synthetic test-data generation
    substitute.ts           # {{VAR}} substitution into test defs
    workers/
      http-worker.ts        # HTTP test runner (undici)
      browser-worker.ts     # Playwright runner (screenshots, assertions) +
                            #   capturePageContext (live DOM snapshot for selector grounding)
      script-worker.ts      # Python runner (QA_VARS in, ##QA_RESULT## out)

  frontend/src/
    main.tsx                # AuthProvider + AuthGate + RouterApp
    RouterApp.tsx           # routes (/ = use case list, /process/:key, node authoring)
    Layout.tsx              # nav, user info, sign-out
    auth.tsx                # AuthProvider, useAuth, GoogleSignInButton
    AuthGate.tsx            # gates whole app when backend requires auth
    api.ts                  # typed fetch helpers + auth token / 401 handling
    pages/
      UseCaseListPage.tsx   # landing: cards w/ metrics, search, new, delete
      DesignPage.tsx        # modeler: design/run modes, rename, run modal
    authoring/AuthoringWorkspace.tsx  # legacy full-page per-node authoring (Excel import/export)
    authoring/NodeTestDrawer.tsx      # in-panel node authoring (right side nav): tree + modes + I/O + steps + runs
    copilot/                # AI copilot UI (currently hidden)
    traceability/           # traceability matrix UI
    runs/                   # run views
    BpmnModeler.tsx / BpmnRunCanvas.tsx / BpmnCanvas.tsx
    TestConfigPanel.tsx / RunPanel.tsx
    styles.css

  data/                     # created at runtime
    runs.json               # run records
    screenshots/  logs/  scripts/
```

---

## 4. Core Concepts & Data Model

- **Process / Use case** — a BPMN file (`bpmn/<key>.bpmn`). `key` matches
  `^[a-z][a-z0-9_]{1,63}$`. The human name is the `<bpmn:process name="...">`.
- **Tags** (`tags/<key>.json`) — `{ processKey, elementTests }` mapping a BPMN
  element id to one executable `TestDef`. This is what the engine runs.
- **Test Plan** (`plans/<key>.json`) — hierarchical authoring model:
  `NodePlan -> TestSuite[] -> Scenario[] -> TestCase[]`, each case has an
  `executable` (TestDef), `steps`, `variables`, and `dataSets`. Compiling a plan
  produces the flat `elementTests` written back to tags.
- **Extended authoring fields** (added for the in-panel node authoring drawer;
  persisted as extra JSON keys, preserved on round-trip by `upsertPlan`):
  - `executionMode` on each **suite** and **case**: `"hitl" | "agent" | "executor"`
    - `hitl` — fully manual, human runs and records the result.
    - `agent` — layman-language steps executed in the browser by an agent.
    - `executor` — a code block run after manual cases to automate the case.
  - `inputs` / `outputs` on each case — typed parameter rows:
    `{ id, name, type, source?, value? }` where `type ∈
    text|number|email|url|date|boolean|json`. An output of an upstream node can be
    referenced as a downstream input via `source = "<nodeId>.<outputName>"`
    (output→input chaining). New cases start with **one** input and **one** output.
  - `steps[]` carry the manual detail: `name`, `action`, `expectedResult`
    (taller textareas, shown side by side) plus step-level **test data** `fields[]`
    (`{ id, name, type, value }`). Test data lives at the **step** level.
  - `manualResult` / `manualResultBy` on a case capture HITL pass/fail/skip.
- **Meta** (`meta/<key>.json`) — ownership stamp: `createdBy` (email),
  `createdByName`, `createdAt`.
- **Run record** (`data/runs.json`) — per-run results keyed by `runId`; fields
  include `processKey`, `kind` (`workflow|plan`), `environment`, `tag`,
  `startedBy`, `startedAt`, `finishedAt`, and per-activity `results`.

### Test definition types (`TestDef`)
- `http.api` — method, url, headers, body, expect (status + jsonPath), setVariables.
- `browser.playwright` — ordered steps (`goto`, `click`, `fill`, `press`,
  `assertContains`, `screenshot`, waits, etc.), setVariables.
- `script.python` — inline code; reads `QA_VARS` env (JSON), emits results via a
  `##QA_RESULT##` JSON line; exit code 0 = pass.

### Inter-node variable passing
A shared **variable bag** flows between nodes. Steps can write outputs via
`setVariables`; later steps/nodes substitute with `{{VAR_NAME}}`. Python steps
receive inputs in `QA_VARS` and return `setVariables` in `##QA_RESULT##`.

---

## 5. Features Implemented

### Workflow modeling & execution
- bpmn-js **modeler** (edit) and **run canvas** (live status overlay:
  passed/failed/running/executed) with polling.
- Embedded engine executes service tasks through the matching worker; gateways,
  flows, and conditions evaluate on engine variables.
- **Start Run modal** prompts for **environment** and **tag/label** before a run.

### Use case landing page (`/`)
- Cards per use case with **traceability metrics**: test-case count,
  automated vs manual, passed/failed/not-run pills, pass-rate bar, node count,
  last-run date.
- **Created by** and **Last run by** attribution on each card.
- Search, **New use case** button (relocated here), and **Delete** control.
- **New use case** opens an **in-page modal** (no browser `prompt()`), with a
  name + auto-derived key and a **template gallery** that lists existing use cases
  with business descriptions and metrics to clone from (or start blank).
- The modeler **canvas** uses a dotted-grid background for a true canvas look.

### Modeler page header
- Prominent use case **name** + key, **back** link, **Rename**, **Duplicate**,
  **Delete**, Design/Run toggle, Save, Start Run. Shows **creator** in header.

### Authoring workspace (per node)
- Hierarchical authoring (suites/scenarios/cases/steps), test-data sets with
  Faker generation, and **Excel import/export** of test cases (`xlsx`).

### In-panel node authoring drawer (`NodeTestDrawer`, latest work)
The native BPMN behaviour is untouched; selecting a task node extends the
existing **right side nav** (no overlay, no conflict with the BPMN context pad).
- **30 / 70 layout**: left ~30% is the suite → scenario → case tree; right ~70%
  is the selected case detail.
- **Tree icons** differentiate levels: suite `▤`, scenario `❏`, and case glyphs
  by mode (HITL `☑`, Agent `✦`, Executor `❮❯`).
- **Inline rename + delete in the tree**: hovering a suite, scenario, or case
  reveals a pencil (✎) and a trash (🗑) next to each other. Rename edits in place
  (Enter commits, Esc cancels); delete confirms and cascades (suite→scenarios→
  cases). The right panel shows a **suite-only** breadcrumb (scenario name lives
  in the tree) plus a compact action toolbar.
- **Execution modes** (HITL / Agent / Executor) are selected **per case** (the
  suite-level execution-mode bar was removed). New cases default to HITL.
- **Input / output parameters** use an identical, compact **name + value** row
  (the per-field type dropdown was removed); one input and one output by default.
  Upstream output→input chaining values are preserved on round-trip in the JSON.
- **Steps**: a single **Test step + Expected result** pair shown together
  (stacked textareas, numbered, corner delete) — no separate action/step concept.
  Optional **step-level test data** fields (name + value) can be added per step.
- **Mode-specific detail**:
  - **HITL** — plain-English steps only; a human runs and records the result.
  - **Agent** — plain-English steps only; **no Playwright editor is shown**. The
    automation is generated from the steps **at run time** (see AI agent execution).
  - **Executor** — shows only **inputs, outputs, and the code block** (Python/HTTP);
    the description and step list are hidden in this mode.
- **Sheet upload** (Excel/CSV via `xlsx`) at **suite**, **scenario**, and **case**
  levels, shown as compact **real Excel + Google Drive icon buttons**. Robust
  column-alias matching (Test Case / Test Step / Expected Result / Scenario /
  Suite + many synonyms); rows import as **test cases and steps** (one row per
  case when there is no case column). Unknown columns become step-level test data,
  **not** input parameters. Import shows a success/empty toast. The **Google
  Drive** button is stubbed (full OAuth flow planned for a later iteration).
- **Run from the toolbar**: the **Env selector + ▶ Run scenario + + Test case**
  live together on one toolbar row to save space; live status polls and **browser
  screenshots** render inline at the scenario level.
- **Pass / Fail / Skip** per case is recorded **at the bottom** of the case block
  (after the steps) — editable by a human for HITL, reflected read-only from the
  run for Agent/Executor cases.

### AI agent execution (NL → Playwright, latest work)
Agent-mode cases are authored entirely in **plain English** and executed by an AI
layer that converts steps to a runnable Playwright script — no hand-written
automation required.
- **At run time**, `testRuns.startTestRun` calls `ensureAgentExecutables(plan)`,
  which for each agent case converts its `steps[]` (`action` + `expectedResult`)
  into a `browser.playwright` `executable` via `ai.generateBrowserAutomation`.
- **Selector grounding**: `browser-worker.capturePageContext(url)` loads the
  derived start URL (first http(s) URL found in the case inputs/steps/fields) and
  snapshots interactive elements + real selectors, which are passed to the model
  so it emits plausible selectors rather than guesses.
- **Deterministic & cached**: the generated steps are stored back into the plan
  and tagged with a `__autoStepsHash` fingerprint of the source steps. The model
  is only called when steps change; unchanged cases reuse the stored automation
  (so steady-state runs are deterministic and cost nothing). **Hand-authored**
  executables (those without the fingerprint, e.g. seeded demos) are respected and
  never overwritten.
- **Model output is constrained** to the worker's allowed actions (`goto`, `click`,
  `tryClick`, `fill`, `press`, `assertContains`, `assertVisible`, `screenshot`,
  waits) and validated/filtered server-side; a `goto` is prepended if a start URL
  is known. Failures surface a clear error on the run.
- **No special conversion library** is used — just the `openai` SDK for generation
  and `playwright` for grounding + execution. There is also a manual endpoint
  `POST /api/ai/automation` (used during development) and a frontend helper
  `aiGenerateAutomation`, but the live UX relies on the run-time path above.

### Ownership & permissions (latest work)
- Process creation/first-save stamps the creator into `meta/<key>.json`.
- **Owner-only delete**: only the creator can delete an owned use case
  (backend returns 403 otherwise); anyone can open/run. Seeded/unowned use cases
  are deletable by anyone until owned. When auth is disabled, delete is open.
- UI hides/disables the delete control for non-owners on both the landing page
  and the modeler header.

### Authentication (Google)
- Frontend gates the whole app via `AuthGate` + Google Identity Services.
- Backend verifies Google ID tokens, restricts to an allowed email **domain**
  (e.g. `phenom.com`), and attaches the user to requests for attribution.
- Auth is **config-gated**: enabled only when `GOOGLE_CLIENT_ID` is set; degrades
  gracefully to open mode otherwise. `GET /api/auth/config` and
  `GET /api/auth/me` expose state.

### Traceability
- `buildUseCaseSummaries()` (per-process metrics) and `buildTraceability(view)`
  with multiple views (workflow→suite/scenario/case, case→workflow/results),
  coverage gaps, failed cases, and trends.

### AI assist (present, copilot button currently hidden)
- `POST /api/ai/workflow` (generate BPMN from prompt), `/workflow/modify`,
  `/recommend` (suggest test assets).

### Seeded HR-tech demo use cases (anchored to real phenom.com pages)
- `career_site_experience` → `/career-site`
- `talent_crm_pipeline` → `/talent-crm`
- `applied_ai_hiring` → `/artificial-intelligence`
- `hr_resources_hub` → `/resources`
- `customer_success_stories` → `/customers`
- Plus originals: `order_fulfillment` (HTTP/offline mock), `google_ai_search`
  (browser), `py_smoke` (Python).

**New-format demo use cases** (authored with the in-panel drawer; exercise modes,
typed I/O, step test data, and output→input chaining):
- `phenom_candidate_apply` — Open Career Site → Search Jobs → Submit Application
  (Agent + HITL + Executor cases; `career_site_url`/`first_job_title`/`application_id`
  chained between nodes).
- `phenom_hiring_manager_review` — Review Shortlist → Schedule Interview
  (HITL + Executor + Agent cases; `selected_candidate_id` chained downstream).

---

## 6. HTTP API (Fastify)

Open (no auth): `GET /api/health`, `GET /api/auth/config`,
`/api/screenshots/*`, `/api/logs/*`. All other `/api/*` are gated when auth is on.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | health check |
| GET | `/api/auth/config` | `{ enabled, domain }` |
| GET | `/api/auth/me` | current user |
| GET | `/api/processes` | list process summaries |
| GET | `/api/processes/:key` | full process def (bpmn + tags + meta) |
| POST | `/api/processes` | create (blank or from `sourceKey`); stamps creator |
| PUT | `/api/processes/:key` | save bpmn + tags; stamps creator on first save |
| PATCH | `/api/processes/:key` | rename (updates BPMN `name`) |
| DELETE | `/api/processes/:key` | **owner-only**; 403 if not creator |
| GET/PUT | `/api/processes/:key/plan` | get/save test plan (PUT compiles to tags) |
| POST | `/api/processes/:key/plan/nodes/:nodeId/cases` | bulk upsert cases |
| GET | `/api/processes/:key/plan/export` | export plan |
| POST | `/api/processes/:key/plan/import` | import plan + sync tags |
| POST | `/api/processes/:key/plan/compile` | compile plan → element tests |
| POST | `.../datasets/:dataSetId/generate` | Faker rows for a dataset |
| GET | `/api/usecases` | use case summaries (metrics + attribution) |
| GET | `/api/traceability?view=` | traceability rows + insights |
| POST | `/api/ai/workflow` `/workflow/modify` `/recommend` | AI assist |
| POST | `/api/ai/automation` | NL steps → `browser.playwright` (grounded; dev/manual) |
| POST | `/api/runs` | start workflow run (`processKey`, `environment`, `tag`) |
| GET | `/api/runs` / `/api/runs/:id` | list / poll run state |
| POST | `/api/test-runs` | start plan-scoped run (scope + environment) |
| * | `/mock/*` | built-in demo endpoints (order fulfillment) |

---

## 7. Environment Variables

**Backend**
- `PORT` / `API_PORT` (default 4000)
- `BPMN_DIR`, `DATA_DIR` (override storage roots)
- `ALLOWED_ORIGIN` (CORS; comma list or `/regex/`)
- `GOOGLE_CLIENT_ID` (enables auth when set)
- `ALLOWED_EMAIL_DOMAIN` (e.g. `phenom.com` — **not** the client id)
- `OPENAI_API_KEY` (enables AI workflow gen + **agent NL→Playwright** execution)
- `OPENAI_MODEL` (optional; defaults to `gpt-4o-mini`)
- Loaded from `backend/.env` at startup via `process.loadEnvFile` (Node 22+).
  `.env` files are gitignored (`**/.env`), so keys are never committed/pushed. On
  Hugging Face, set `OPENAI_API_KEY` as a Space **secret** instead of a file.

**Frontend (Vite)**
- `VITE_API_BASE_URL` (backend base URL)
- `VITE_GOOGLE_CLIENT_ID` (same client id as backend)

> Gotcha learned: `ALLOWED_EMAIL_DOMAIN` must be the bare domain (`phenom.com`),
> not the OAuth client id. `/api/auth/config` should read `{enabled:true, domain:"phenom.com"}`.

---

## 8. Local Development

```bash
npm run install:all     # install root + backend + frontend
npm run dev             # backend :4000, frontend :5173
# Typecheck / build
cd backend && npm run typecheck
cd frontend && npm run build     # tsc -b && vite build
```

Conventions:
- Backend TS runs directly via `node --experimental-strip-types` (no build step
  for dev); `.ts` import specifiers are used in source.
- All persistence is flat JSON under `bpmn/` and `data/` — there is **no DB**.

---

## 9. Deployment

- **Frontend → Vercel.** Reads the API via `VITE_API_BASE_URL`. Redeploys on push
  to GitHub `main`. (Vercel needs the frontend commit on GitHub, not only HF.)
- **Backend → Hugging Face Spaces (Docker SDK).** `Dockerfile` builds the image;
  HF has **no persistent disk**, so `bpmn/` seed files must be committed and
  pushed to the `hf` remote to be baked into the image. Env vars are set in the
  Space settings.

Push (network/SSL workarounds learned in this environment):
```bash
GIT_SSL_NO_VERIFY=true git push origin main   # GitHub -> Vercel
GIT_SSL_NO_VERIFY=true git push hf main        # Hugging Face -> backend
```

---

## 10. Known Constraints / Notes

- Browser demo use cases hit the **public phenom.com** marketing site, so cloud
  runs may occasionally trip bot protection; assertions use stable on-page text.
- AI **Copilot button is intentionally hidden** in the UI (endpoints still exist).
- Sandbox limitations seen previously: can't kill stray ports, Playwright/Python
  setup needed Dockerfile tweaks, and git pushes needed `GIT_SSL_NO_VERIFY`.

---

## 11. How to Reuse This Doc

At the start of a new chat, reference this file:

> "Context: see `@REQUIREMENTS.md`. Work in `/Users/hari.peddi/QA Flow`.
> [your task]"

Keeping chats scoped to one task (and pointing at specific files with `@`) keeps
context small and responses fast.
