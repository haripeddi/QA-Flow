import { listProcesses } from "./processes.ts";
import { getPlan, listAllCases } from "./plans.ts";
import { listRuns, type RunRecord } from "./store.ts";

export type TraceabilityView =
  | "workflow_to_suite"
  | "workflow_to_scenario"
  | "workflow_to_case"
  | "case_to_workflow"
  | "case_to_results";

export interface TraceabilityInsights {
  workflowsCreated: number;
  workflowsExecuted: number;
  suitesCreated: number;
  scenariosCreated: number;
  casesCreated: number;
  casesExecuted: number;
  passed: number;
  failed: number;
  executed: number;
  coverageGaps: Array<{ processKey: string; nodeId: string; reason: string }>;
  failedCases: Array<{
    processKey: string;
    caseId?: string;
    caseName?: string;
    nodeId?: string;
    message?: string;
  }>;
  trends: Array<{ date: string; passed: number; failed: number }>;
}

export interface UseCaseSummary {
  key: string;
  name: string;
  description?: string;
  updatedAt?: string;
  nodeCount: number;
  testCaseCount: number;
  automatedCount: number;
  manualCount: number;
  passed: number;
  failed: number;
  notRun: number;
  runCount: number;
  lastRunAt?: string;
}

export async function buildUseCaseSummaries(): Promise<UseCaseSummary[]> {
  const processes = await listProcesses();
  const runs = await listRuns();
  const summaries: UseCaseSummary[] = [];

  for (const proc of processes) {
    const plan = await getPlan(proc.key);
    const cases = listAllCases(plan);
    let automatedCount = 0;
    let manualCount = 0;
    let passed = 0;
    let failed = 0;
    let notRun = 0;

    for (const entry of cases) {
      if (entry.testCase.executable) automatedCount++;
      else manualCount++;
      const last = findLastResultForCase(runs, proc.key, entry.testCase.id);
      if (!last) notRun++;
      else if (last.status === "passed") passed++;
      else if (last.status === "failed") failed++;
      else notRun++;
    }

    const procRuns = runs.filter((r) => r.processKey === proc.key);
    let lastRunAt: string | undefined;
    for (const r of procRuns) {
      const at = r.finishedAt ?? r.startedAt;
      if (at && (!lastRunAt || at > lastRunAt)) lastRunAt = at;
    }

    summaries.push({
      key: proc.key,
      name: proc.name,
      description: proc.description,
      updatedAt: proc.updatedAt,
      nodeCount: Object.keys(plan.nodes).length,
      testCaseCount: cases.length,
      automatedCount,
      manualCount,
      passed,
      failed,
      notRun,
      runCount: procRuns.length,
      lastRunAt,
    });
  }

  summaries.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return summaries;
}

export interface TraceabilityRow {
  workflowKey: string;
  workflowName: string;
  nodeId?: string;
  suiteId?: string;
  suiteName?: string;
  scenarioId?: string;
  scenarioName?: string;
  caseId?: string;
  caseName?: string;
  lastStatus?: string;
  lastRunAt?: string;
}

export async function buildTraceability(view: TraceabilityView): Promise<{
  view: TraceabilityView;
  rows: TraceabilityRow[];
  insights: TraceabilityInsights;
}> {
  const processes = await listProcesses();
  const runs = await listRuns();
  const rows: TraceabilityRow[] = [];
  let suitesCreated = 0;
  let scenariosCreated = 0;
  let casesCreated = 0;
  const coverageGaps: TraceabilityInsights["coverageGaps"] = [];
  const failedCases: TraceabilityInsights["failedCases"] = [];
  const trendMap = new Map<string, { passed: number; failed: number }>();

  const executedWorkflows = new Set(
    runs.map((r) => r.processKey),
  );
  let casesExecuted = 0;
  let passed = 0;
  let failed = 0;
  let executed = 0;

  for (const r of runs) {
    for (const result of Object.values(r.results)) {
      if (r.kind === "plan" || result.traceability?.caseId) {
        casesExecuted++;
      }
      if (result.status === "passed") passed++;
      else if (result.status === "failed") failed++;
      else if (result.status === "executed") executed++;
      if (result.finishedAt) {
        const day = result.finishedAt.slice(0, 10);
        const t = trendMap.get(day) ?? { passed: 0, failed: 0 };
        if (result.status === "passed") t.passed++;
        if (result.status === "failed") t.failed++;
        trendMap.set(day, t);
      }
      if (result.status === "failed" && result.traceability) {
        failedCases.push({
          processKey: r.processKey,
          caseId: result.traceability.caseId,
          caseName: result.traceability.caseName,
          nodeId: result.traceability.nodeId,
          message: result.message,
        });
      }
    }
  }

  for (const proc of processes) {
    const plan = await getPlan(proc.key);
    const cases = listAllCases(plan);
    for (const node of Object.values(plan.nodes)) {
      if (node.suites.length === 0) {
        coverageGaps.push({
          processKey: proc.key,
          nodeId: node.nodeId,
          reason: "no test suites",
        });
      }
    }
    for (const entry of cases) {
      suitesCreated += plan.nodes[entry.nodeId]?.suites.length ?? 0;
      scenariosCreated += 1;
      casesCreated += 1;
      if (!entry.testCase.executable) {
        coverageGaps.push({
          processKey: proc.key,
          nodeId: entry.nodeId,
          reason: `case "${entry.testCase.name}" has no executable`,
        });
      }
      const last = findLastResultForCase(runs, proc.key, entry.testCase.id);
      rows.push({
        workflowKey: proc.key,
        workflowName: proc.name,
        nodeId: entry.nodeId,
        suiteId: entry.suiteId,
        scenarioId: entry.scenarioId,
        caseId: entry.testCase.id,
        caseName: entry.testCase.name,
        lastStatus: last?.status,
        lastRunAt: last?.finishedAt,
      });
    }
  }

  const insights: TraceabilityInsights = {
    workflowsCreated: processes.length,
    workflowsExecuted: executedWorkflows.size,
    suitesCreated,
    scenariosCreated,
    casesCreated,
    casesExecuted,
    passed,
    failed,
    executed,
    coverageGaps,
    failedCases,
    trends: [...trendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
  };

  const filtered = filterRowsByView(rows, view);
  return { view, rows: filtered, insights };
}

function findLastResultForCase(
  runs: RunRecord[],
  processKey: string,
  caseId: string,
) {
  let best: { status: string; finishedAt?: string } | undefined;
  for (const run of runs) {
    if (run.processKey !== processKey) continue;
    for (const result of Object.values(run.results)) {
      if (result.traceability?.caseId !== caseId) continue;
      if (!best || (result.finishedAt ?? "") > (best.finishedAt ?? "")) {
        best = { status: result.status, finishedAt: result.finishedAt };
      }
    }
  }
  return best;
}

function filterRowsByView(
  rows: TraceabilityRow[],
  view: TraceabilityView,
): TraceabilityRow[] {
  if (view === "workflow_to_suite") {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = `${r.workflowKey}:${r.nodeId}:${r.suiteId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (view === "workflow_to_scenario") {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = `${r.workflowKey}:${r.scenarioId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (view === "case_to_workflow" || view === "case_to_results") {
    return rows;
  }
  return rows;
}
