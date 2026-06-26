import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [baselineRoot, treatmentRoot, format = "markdown"] = process.argv.slice(2);

if (baselineRoot === undefined || treatmentRoot === undefined) {
  throw new Error(
    "Usage: node scripts/compare-tool-execution-latency.mjs <baseline-root> <treatment-root> [markdown|json]",
  );
}
if (format !== "markdown" && format !== "json") {
  throw new Error(`Unknown output format: ${format}`);
}

const [baseline, treatment] = await Promise.all([
  readTraces(resolve(baselineRoot)),
  readTraces(resolve(treatmentRoot)),
]);
const comparison = compareTraces(baseline, treatment);

process.stdout.write(
  format === "json" ? `${JSON.stringify(comparison, null, 2)}\n` : renderMarkdown(comparison),
);

async function readTraces(root) {
  const traces = [];
  for (const file of await findJsonFiles(root)) {
    const payload = parseJson(await readFile(file, "utf8"));
    if (!isRecord(payload) || !isRecord(payload.result) || !Array.isArray(payload.result.logs))
      continue;

    for (const log of payload.result.logs) {
      if (typeof log !== "string") continue;
      const trace = parseTrace(log);
      if (trace !== undefined) traces.push(trace);
    }
  }
  if (traces.length === 0) throw new Error(`No timing traces found under ${root}.`);
  return traces;
}

async function findJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return await findJsonFiles(path);
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    }),
  );
  return nested.flat();
}

function parseTrace(value) {
  const parsed = parseJson(value);
  if (!isRecord(parsed) || typeof parsed.kind !== "string" || !isRecord(parsed.timing)) {
    return undefined;
  }
  return { kind: parsed.kind, timing: parsed.timing };
}

function compareTraces(baseline, treatment) {
  const baselineByKind = groupByKind(baseline);
  const treatmentByKind = groupByKind(treatment);
  const kinds = [...baselineByKind.keys()]
    .filter((kind) => treatmentByKind.has(kind))
    .sort((left, right) => left.localeCompare(right));

  if (kinds.length === 0) {
    throw new Error("Baseline and treatment do not contain a shared trace kind.");
  }

  return {
    baselineTrials: baseline.length,
    treatmentTrials: treatment.length,
    kinds: kinds.map((kind) =>
      compareKind(kind, baselineByKind.get(kind), treatmentByKind.get(kind)),
    ),
  };
}

function groupByKind(traces) {
  const grouped = new Map();
  for (const trace of traces) {
    const group = grouped.get(trace.kind) ?? [];
    group.push(trace);
    grouped.set(trace.kind, group);
  }
  return grouped;
}

function compareKind(kind, baseline, treatment) {
  const metricNames = new Set([
    ...baseline.flatMap((trace) => Object.keys(trace.timing)),
    ...treatment.flatMap((trace) => Object.keys(trace.timing)),
  ]);

  return {
    baselineTrials: baseline.length,
    kind,
    metrics: [...metricNames]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((metric) => {
        const baselineValues = numericValues(baseline, metric);
        const treatmentValues = numericValues(treatment, metric);
        if (baselineValues.length === 0 || treatmentValues.length === 0) return [];
        return [compareMetric(metric, baselineValues, treatmentValues)];
      }),
    treatmentTrials: treatment.length,
  };
}

function numericValues(traces, metric) {
  return traces
    .map((trace) => trace.timing[metric])
    .filter((value) => typeof value === "number" && Number.isFinite(value));
}

function compareMetric(metric, baseline, treatment) {
  const baselineSummary = summarize(baseline);
  const treatmentSummary = summarize(treatment);
  const medianDifferenceMs = treatmentSummary.p50 - baselineSummary.p50;
  const bootstrapCiMs = bootstrapMedianDifferenceCi(baseline, treatment);
  const mannWhitneyPValue = calculateMannWhitneyPValue(baseline, treatment);
  const statisticallySignificant =
    baseline.length >= 10 &&
    treatment.length >= 10 &&
    mannWhitneyPValue < 0.05 &&
    (bootstrapCiMs[1] < 0 || bootstrapCiMs[0] > 0);

  return {
    baseline: baselineSummary,
    bootstrapCiMs,
    mannWhitneyPValue,
    medianDifferenceMs,
    metric,
    statisticallySignificant,
    treatment: treatmentSummary,
  };
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

function bootstrapMedianDifferenceCi(baseline, treatment) {
  const random = seededRandom(0x5eedc0de);
  const differences = [];
  for (let iteration = 0; iteration < 20_000; iteration += 1) {
    differences.push(
      median(sampleWithReplacement(treatment, random)) -
        median(sampleWithReplacement(baseline, random)),
    );
  }
  differences.sort((left, right) => left - right);
  return [percentile(differences, 0.025), percentile(differences, 0.975)];
}

function sampleWithReplacement(values, random) {
  const sample = [];
  for (let index = 0; index < values.length; index += 1) {
    sample.push(values[Math.floor(random() * values.length)]);
  }
  return sample;
}

function median(values) {
  return percentile(
    [...values].sort((left, right) => left - right),
    0.5,
  );
}

function percentile(sorted, quantile) {
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function calculateMannWhitneyPValue(baseline, treatment) {
  const combined = [
    ...baseline.map((value) => ({ group: "baseline", value })),
    ...treatment.map((value) => ({ group: "treatment", value })),
  ].sort((left, right) => left.value - right.value);
  const ranks = new Map();
  let tieCorrection = 0;

  for (let start = 0; start < combined.length; ) {
    let end = start + 1;
    while (end < combined.length && combined[end].value === combined[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks.set(combined[index], rank);
    const tieCount = end - start;
    tieCorrection += tieCount ** 3 - tieCount;
    start = end;
  }

  const baselineRankSum = combined
    .filter((entry) => entry.group === "baseline")
    .reduce((sum, entry) => sum + ranks.get(entry), 0);
  const baselineCount = baseline.length;
  const treatmentCount = treatment.length;
  const totalCount = combined.length;
  const u = baselineRankSum - (baselineCount * (baselineCount + 1)) / 2;
  const mean = (baselineCount * treatmentCount) / 2;
  const variance =
    (baselineCount *
      treatmentCount *
      (totalCount + 1 - tieCorrection / (totalCount * (totalCount - 1)))) /
    12;
  if (variance === 0) return 1;

  const z = Math.max(0, Math.abs(u - mean) - 0.5) / Math.sqrt(variance);
  return 2 * (1 - normalCdf(z));
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-absolute * absolute));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function renderMarkdown(comparison) {
  const rows = comparison.kinds.flatMap((kind) =>
    kind.metrics.map((metric) =>
      [
        kind.kind,
        metric.metric,
        `${metric.baseline.count}/${metric.treatment.count}`,
        formatNumber(metric.baseline.p50),
        formatNumber(metric.treatment.p50),
        formatNumber(metric.medianDifferenceMs),
        `${formatNumber(metric.bootstrapCiMs[0])} to ${formatNumber(metric.bootstrapCiMs[1])}`,
        formatPValue(metric.mannWhitneyPValue),
        metric.statisticallySignificant ? "yes" : "no",
      ].join(" | "),
    ),
  );

  return [
    "## Observed latency comparison",
    "",
    `Baseline trials: ${comparison.baselineTrials}; treatment trials: ${comparison.treatmentTrials}.`,
    "",
    "| Trace kind | Metric (ms) | n base/treatment | Base p50 | Treatment p50 | Delta | Bootstrap 95% CI | Mann-Whitney p | Significant |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
    "Delta is treatment minus baseline. Significance requires n >= 10 per group, two-sided Mann-Whitney p < 0.05, and a bootstrap 95% median-difference interval that excludes zero.",
    "",
  ].join("\n");
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPValue(value) {
  return value < 0.0001 ? "<0.0001" : value.toFixed(4);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
