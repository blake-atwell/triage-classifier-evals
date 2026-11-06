import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { callModelWithRetry, loadPrompt } from "./llm";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

type Label = {
  category: string;
  priority: string;
  route_to: string;
};

type EvalCase = {
  id: string;
  input: string;
  expected: Label;
};

type TrialResult =
  // Schema-valid label, and it matched expected.
  | { status: "pass"; output: Label; raw: string }
  // Schema-valid label, but it didn't match expected.
  | { status: "fail"; output: Label; raw: string; reasons: string[] }
  // Got a response, but it couldn't be parsed into a schema-valid label.
  | { status: "malformed"; output: null; raw: string; reasons: string[] }
  // The API call itself failed after retries; nothing to grade.
  | { status: "error"; raw: string; reasons: string[] };

type CaseResult = {
  id: string;
  input: string;
  expected: Label;
  trials: TrialResult[];
  trialPassCount: number; // trials with status "pass"
  passed: boolean; // every trial passed
};

const ALLOWED: Record<keyof Label, string[]> = {
  category: ["billing", "technical", "account", "other"],
  priority: ["low", "medium", "high", "urgent"],
  route_to: ["tier1", "tier2", "specialist"],
};

const FIELDS = Object.keys(ALLOWED) as (keyof Label)[];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const config = {
  model: process.env.EVAL_MODEL ?? "gemini-3.5-flash-lite",
  // Minimum fraction of cases that must pass for CI to go green.
  threshold: Number(process.env.EVAL_THRESHOLD ?? "1.0"),
  // Run each case N times; a case passes only if every trial passes; Flakiness probe.
  trials: Number(process.env.EVAL_TRIALS ?? "3"),
  concurrency: Number(process.env.EVAL_CONCURRENCY ?? "10"),
  datasetPath: process.env.EVAL_DATASET ?? "./dataset.json",
  promptPath: process.env.EVAL_PROMPT ?? "./prompt.txt",
  resultsPath: process.env.EVAL_RESULTS ?? "./eval-results.json",
};

// ---------------------------------------------------------------------------
// Parsing & grading
// ---------------------------------------------------------------------------

/** Parse the model's reply into a schema-valid label or explain why not. */
export function parseOutput(raw: string): { output: Label | null; reasons: string[] } {
  // Models frequently wrap JSON in Markdown fences despite instructions.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return { output: null, reasons: [`response is not valid JSON: ${truncate(raw)}`] };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { output: null, reasons: ["response JSON is not an object"] };
  }

  const obj = parsed as Record<string, unknown>;
  const reasons: string[] = [];
  for (const field of FIELDS) {
    const value = obj[field];
    if (typeof value !== "string" || !ALLOWED[field].includes(value)) {
      reasons.push(`invalid ${field}: ${JSON.stringify(value)}`);
    }
  }
  if (reasons.length > 0) return { output: null, reasons };

  return {
    output: { category: obj.category, priority: obj.priority, route_to: obj.route_to } as Label,
    reasons: [],
  };
}

/** Compare a schema-valid label against the expected one. */
export function grade(c: EvalCase, output: Label, raw: string): TrialResult {
  const failures: string[] = [];
  for (const field of FIELDS) {
    if (output[field] !== c.expected[field]) {
      failures.push(`${field}: expected "${c.expected[field]}", got "${output[field]}"`);
    }
  }

  return failures.length > 0
    ? { status: "fail", output, raw, reasons: failures }
    : { status: "pass", output, raw };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Call the model once and take the response through parse → grade. */
async function runEvalCaseTrial(evalCase: EvalCase, prompt: string): Promise<TrialResult> {
  let raw: string;
  try {
    raw = await callModelWithRetry(prompt, config.model, {
      temperature: 0, // Mirror production
    });
  } catch (err) {
    return { status: "error", raw: "", reasons: [`API error: ${String(err)}`] };
  }

  const { output, reasons } = parseOutput(raw);
  if (!output) {
    return { status: "malformed", output: null, raw, reasons };
  }

  return grade(evalCase, output, raw);
}

async function runEvalCase(evalCase: EvalCase): Promise<CaseResult> {
  const prompt = loadPrompt(config.promptPath, { message: evalCase.input });
  const trials: TrialResult[] = [];
  for (let i = 0; i < config.trials; i++) {
    trials.push(await runEvalCaseTrial(evalCase, prompt));
  }
  const trialPassCount = trials.filter((t) => t.status === "pass").length;
  return {
    id: evalCase.id,
    input: evalCase.input,
    expected: evalCase.expected,
    trials,
    trialPassCount,
    passed: trialPassCount === trials.length,
  };
}

async function runEvalCaseList(evalCaseList: EvalCase[]): Promise<CaseResult[]> {
  const results: CaseResult[] = new Array(evalCaseList.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(config.concurrency, evalCaseList.length) }, async () => {
    // Each Worker runs unclaimed EvalCase until list exhausted.
    while (next < evalCaseList.length) {
      const i = next++;
      results[i] = await runEvalCase(evalCaseList[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function truncate(s: string, n = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

function failureReasons(r: CaseResult): string[] {
  return [...new Set(r.trials.flatMap((t) => (t.status === "pass" ? [] : t.reasons)))];
}

function computeMetrics(results: CaseResult[]) {
  const allTrials = results.flatMap((r) => r.trials);
  // Trials where the API call succeeded — the denominator for output-quality
  // rates, so an outage doesn't read as the model emitting bad JSON.
  const completedTrials = allTrials.filter((t) => t.status !== "error");

  // Malformed outputs count as wrong for every field.
  const perFieldAccuracy: Record<string, number> = {};
  for (const field of FIELDS) {
    let correct = 0;
    let total = 0;
    for (const r of results) {
      for (const t of r.trials) {
        if (t.status === "error") continue;
        total++;
        if (t.output && t.output[field] === r.expected[field]) correct++;
      }
    }
    perFieldAccuracy[field] = total > 0 ? correct / total : 0;
  }

  return {
    evalCasePassRate: results.filter((r) => r.passed).length / results.length,
    evalCaseFlakyCount: results.filter((r) => r.trialPassCount > 0 && !r.passed).length,
    // Transport failures: API call still failing after retries.
    apiErrorRate:
      allTrials.length > 0
        ? allTrials.filter((t) => t.status === "error").length / allTrials.length
        : 0,
    // Model failures: call succeeded, but the response wasn't a schema-valid label.
    malformedRate:
      completedTrials.length > 0
        ? completedTrials.filter((t) => t.status === "malformed").length / completedTrials.length
        : 0,
    // Cases that passed some trials but not all: flaky, not plain wrong.
    perFieldAccuracy,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function writeGithubOutputs(results: CaseResult[], metrics: ReturnType<typeof computeMetrics>, passed: boolean) {
  // Write to file if ENV VAR GITHUB_STEP_SUMMARY is present.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const rows = results
    .map((r) => {
      // Distinguish flaky (some trials passed) from consistently wrong.
      const status = r.passed ? "✅" : r.trialPassCount > 0 ? "⚠️" : "❌";
      const detail = r.passed ? "" : failureReasons(r).join("<br>");
      return `| ${r.id} | ${status} | ${r.trialPassCount}/${r.trials.length} | ${truncate(r.input, 60) || "*(empty)*"} | ${detail} |`;
    })
    .join("\n");

  appendFileSync(
    summaryPath,
    [
      `## Triage classifier evals — ${passed ? "✅ passed" : "❌ failed"}`,
      "",
      `**Model:** \`${config.model}\` · **Trials per case:** ${config.trials} · **Threshold:** ${pct(config.threshold)}`,
      "",
      `| Metric | Value |`,
      `| --- | --- |`,
      `| Case pass rate | ${pct(metrics.evalCasePassRate)} |`,
      `| Flaky cases (mixed trials) | ${metrics.evalCaseFlakyCount} |`,
      `| API error rate | ${pct(metrics.apiErrorRate)} |`,
      `| Malformed output rate | ${pct(metrics.malformedRate)} |`,
      ...FIELDS.map((f) => `| \`${f}\` accuracy | ${pct(metrics.perFieldAccuracy[f])} |`),
      "",
      `| Case | Result | Trials | Input | Failures |`,
      `| --- | --- | --- | --- | --- |`,
      rows,
      "",
    ].join("\n")
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set — refusing to run (every case would fail).");
    process.exit(2);
  }
  const cases: EvalCase[] = JSON.parse(readFileSync(config.datasetPath, "utf8"));
  console.log(
    `Running ${cases.length} cases against ${config.model} ` +
      `(${config.trials} trial(s) each, threshold ${pct(config.threshold)})\n`
  );

  const results = await runEvalCaseList(cases);
  const metrics = computeMetrics(results);
  const passed = metrics.evalCasePassRate >= config.threshold;

  console.log("\nFailures:");
  const failures = results.filter((r) => !r.passed);
  if (failures.length === 0) console.log("  none");
  for (const r of failures) {
    const trialPassRateNote = r.trials.length > 1 ? `(${r.trialPassCount}/${r.trials.length} pass)` : "";
    console.log(`\tCase ID ${r.id} ${trialPassRateNote}`);
    console.log(`\tinput: ${truncate(r.input, 60) || "(empty)"}`)
    for (const reason of failureReasons(r)) console.log(`\t\t- ${reason}`);
  }
  console.log();

  console.log(`Case pass rate:       ${pct(metrics.evalCasePassRate)}`);
  if (config.trials > 1) {
    console.log(`Case flaky count:     ${metrics.evalCaseFlakyCount} (passed some trials but not all)`);
  }
  console.log();

  console.log(`API error rate:       ${pct(metrics.apiErrorRate)} (calls that failed after retries)`);
  console.log(`Malformed output:     ${pct(metrics.malformedRate)} (completed calls without a schema-valid label)`);
  console.log();

  console.log(`Label accuracy`);
  for (const f of FIELDS) console.log(`  ${f} accuracy:`.padEnd(22) + pct(metrics.perFieldAccuracy[f]));
  console.log();

  console.log(`\nResult: ${passed ? "PASS" : "FAIL"} (passed: ${pct(metrics.evalCasePassRate)}, threshold ${pct(config.threshold)})`);

  writeFileSync(
    config.resultsPath,
    JSON.stringify({ config, metrics, passed, results }, null, 2)
  );
  writeGithubOutputs(results, metrics, passed);

  process.exit(passed ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
