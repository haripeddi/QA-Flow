# QA Flow — Code Index (file map)

> One-line-per-file map of the codebase so a chat can find the right file without
> re-exploring. Pair with `@REQUIREMENTS.md` (what/why) — this is the "where".
> When you change what a file does, update its line here. Last updated: 2026-06-08.

Conventions: backend is Node + Fastify (TS run via `--experimental-strip-types`,
so imports use `.ts`). Frontend is React + Vite. Persistence is flat JSON under
`bpmn/` and `data/` (no DB).

---

## Root / config

| File | What it does |
|---|---|
| `package.json` | Orchestration scripts: `install:all`, `dev` (runs backend+frontend via `npm-run-all`). |
| `Dockerfile` | Hugging Face Spaces image for the backend (Playwright + Python + Node). |
| `README.md` | Original walking-skeleton doc. |
| `DEPLOY.md` | Deploy steps: frontend→Vercel, backend→HF Spaces; env/secret setup. |
| `REQUIREMENTS.md` | Project context: purpose, stack, data model, features, API, env. |
| `INDEX.md` | This file — per-file code map. |
| `.gitignore` | Ignores `node_modules`, `dist`, `data/`, and **all `.env`** (`**/.env`). |

## Backend (`backend/`)

| File | What it does | Key exports |
|---|---|---|
| `package.json` | Backend deps + `dev`/`start`/`typecheck` scripts. | — |
| `tsconfig.json` | TS config (typecheck only; no emit). | — |
| `.env` | **Local secrets, gitignored.** `OPENAI_API_KEY`, `OPENAI_MODEL`. | — |
| `src/index.ts` | Entrypoint. Loads `backend/.env` via `process.loadEnvFile`, then `startServer()`. | — |
| `src/server.ts` | All Fastify routes + `/mock/*` demo endpoints; CORS; static screenshots/logs; auth gating. | `startServer` |
| `src/config.ts` | Paths (BPMN/data/tags/plans/meta dirs), ports, env vars, `*PathFor` helpers, `PROCESS_KEY_RE`. | many consts |
| `src/auth.ts` | Google ID-token verify, email-domain gate, token cache, `authPreHandler`, current-user helper. | `verifyToken`, `authPreHandler`, `getUser` |
| `src/processes.ts` | CRUD for BPMN files + meta/ownership; `blankBpmnXml`; delete-permission checks; key validation. | `getProcess`, `upsertProcess`, `listProcesses`, `renameProcess`, `deleteProcess`, `canDeleteProcess`, `validateKey`, `blankBpmnXml`, `ensureDirs` |
| `src/plans.ts` | Test-plan model (suites→scenarios→cases→steps) + load/save (`bpmn/plans/<key>.json`), compile-to-tags, lookups. | `getPlan`, `upsertPlan`, `compilePlanToElementTests`, `findCaseInPlan`, `listAllCases`, `bulkUpsertCases`, types |
| `src/tags.ts` | Loads/caches `bpmn/tags/<key>.json`; defines `TestDef`/`BrowserStep`/`BrowserTestDef`/etc. | `loadTags`, `clearTagsCache`, type `TestDef` |
| `src/engine.ts` | Embedded `bpmn-engine`; ServiceTask override dispatches to workers; live run state for **workflow** runs. | `startNewRun`, `isRunActive`, `getActiveRun` |
| `src/testRuns.ts` | **Plan-scoped** run execution (`scope`→cases), `dispatchTest`, `syncPlanToTags`, and **`ensureAgentExecutables`** (NL→Playwright at run time, cached by step fingerprint). | `startTestRun`, `expandScope`, `syncPlanToTags` |
| `src/store.ts` | `data/runs.json` run-record store; per-activity `TaskResult` upserts; run status. | `createRun`, `upsertResult`, `markRunFinished`, `getRun`, `listRuns`, types |
| `src/substitute.ts` | `{{VAR}}` substitution into test defs (incl. `{{BASE_URL}}`). | `substituteString`, `substituteValue`, `substituteTestDef` |
| `src/traceability.ts` | Per-process metric summaries + traceability matrix across views, coverage gaps, trends. | `buildUseCaseSummaries`, `buildTraceability`, type `TraceabilityView` |
| `src/ai.ts` | OpenAI calls: workflow generate/modify, recommend assets, and **`generateBrowserAutomation`** (NL steps → `browser.playwright`, grounded by live DOM). Reads key lazily. | `generateWorkflowFromPrompt`, `modifyWorkflow`, `recommendTestAssets`, `generateBrowserAutomation` |
| `src/faker.ts` | Spawns `scripts/faker_gen.py` to generate synthetic data rows for a schema. | `generateFakerRows` |
| `src/workers/http-worker.ts` | HTTP test runner via `undici`; status + JSONPath assertions; `setVariables`. | `runHttpTest` |
| `src/workers/browser-worker.ts` | Playwright runner (fixed action set, screenshots) + **`capturePageContext`** (live DOM snapshot for selector grounding). | `runBrowserTest`, `capturePageContext`, `closeBrowser` |
| `src/workers/script-worker.ts` | Python runner; passes `QA_VARS`, parses `##QA_RESULT##`, writes logs. | `runScriptTest` |

## Frontend (`frontend/`)

| File | What it does |
|---|---|
| `package.json` / `tsconfig.json` / `vite.config.ts` | Deps, TS config, Vite config. |
| `vercel.json` | Vercel SPA rewrite/build config. |
| `index.html` | Vite HTML entry (mounts `#root`). |
| `src/main.tsx` | App bootstrap: `AuthProvider` → `AuthGate` → `BrowserRouter` → `RouterApp`; imports `styles.css`. |
| `src/RouterApp.tsx` | Routes: `/` list, `/process/:key` design, `/process/:key/node/:nodeId` authoring, `/traceability`, `/runs`, `/runs/:runId`. |
| `src/Layout.tsx` | App shell: nav, user info, sign-out (wraps routed pages). |
| `src/auth.tsx` | `AuthProvider`, `useAuth`, Google Sign-In button; token storage. |
| `src/AuthGate.tsx` | Gates the whole app when the backend reports auth enabled. |
| `src/api.ts` | Typed `fetch` helpers for every endpoint, auth token/401 handling, shared types (`TestDef`, `PlanTestCase`, etc.), `defaultTestFor`, `aiGenerateAutomation`, asset-URL helpers. |
| `src/App.tsx` | Legacy single-page composition (modeler + config + run panels). Not in the router; kept for reference. |
| `src/styles.css` | All app styles. |
| `src/vite-env.d.ts` | Vite ambient types. |
| **Pages** | |
| `src/pages/UseCaseListPage.tsx` | Landing: use-case cards w/ metrics, search, New-use-case modal + template gallery, delete. |
| `src/pages/DesignPage.tsx` | Modeler page: design/run modes, rename/duplicate/delete, Start-Run modal, embeds `NodeTestDrawer` on node select. |
| **Authoring** | |
| `src/authoring/NodeTestDrawer.tsx` | In-panel per-node authoring (tree + case detail): suites/scenarios/cases, inline rename+delete, per-case modes, inputs/outputs, steps+expected, Excel/Drive import, run scenario + screenshots, bottom result. **Agent cases are plain-English only.** |
| `src/authoring/AuthoringWorkspace.tsx` | Legacy full-page per-node authoring (Excel import/export). |
| **BPMN canvases** | |
| `src/BpmnModeler.tsx` | `bpmn-js` modeler (edit mode); exposes handle + element selection. |
| `src/BpmnRunCanvas.tsx` | Run overlay on the modeler (live pass/fail/running status). |
| `src/BpmnCanvas.tsx` | Read-only `bpmn-js` NavigatedViewer with status overlay (used in run views). |
| **Panels** | |
| `src/TestConfigPanel.tsx` | Per-test editors; exports `HttpForm`, `BrowserForm`, `ScriptForm`. |
| `src/RunPanel.tsx` | Renders run activities, evidence, screenshots/script output. |
| `src/copilot/CopilotPanel.tsx` | AI copilot UI (currently hidden in the app). |
| **Traceability / runs** | |
| `src/traceability/TraceabilityPage.tsx` | Traceability matrix UI (multiple views + insights). |
| `src/runs/TestRunsPage.tsx` | List of plan/workflow runs. |
| `src/runs/TestRunDetailPage.tsx` | Single run detail (activities, evidence, screenshots). |

## Data (flat files, `bpmn/` + `data/`)

| Path | What it holds |
|---|---|
| `bpmn/<key>.bpmn` | BPMN 2.0 XML, one per use case (process). |
| `bpmn/tags/<key>.json` | `{ processKey, elementTests }` — element id → runnable `TestDef` (what the engine runs). |
| `bpmn/plans/<key>.json` | Hierarchical test plan (suites/scenarios/cases/steps, I/O, modes). Source of truth for authoring. |
| `bpmn/meta/<key>.json` | Ownership stamp: `createdBy`, `createdByName`, `createdAt`. |
| `data/runs.json` | Run records keyed by `runId`. |
| `data/screenshots/`, `data/logs/`, `data/scripts/` | Browser screenshots, script logs, generated Python files (runtime). |
| `backend/scripts/faker_gen.py` | Python helper invoked by `faker.ts` for synthetic data. |

---

## Quick "where do I change…?"

- **Add/change an API route** → `backend/src/server.ts` (+ the module it calls).
- **How plan runs execute / agent NL→Playwright** → `backend/src/testRuns.ts`.
- **Browser actions / screenshots / DOM grounding** → `backend/src/workers/browser-worker.ts`.
- **AI prompts / models** → `backend/src/ai.ts`.
- **Test-plan shape or compile-to-tags** → `backend/src/plans.ts`.
- **Node authoring UX (tree, steps, modes, import, run)** → `frontend/src/authoring/NodeTestDrawer.tsx`.
- **API client / shared types** → `frontend/src/api.ts`.
- **Modeler page chrome (rename, run modal, toggle)** → `frontend/src/pages/DesignPage.tsx`.
- **Landing page / use-case cards** → `frontend/src/pages/UseCaseListPage.tsx`.
- **Styles** → `frontend/src/styles.css`.
