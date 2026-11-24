import { writeFileSync } from "node:fs";
import type { MutantCoverage } from "@stryker-mutator/api/core";

interface StrykerNamespace {
  activeMutant?: string;
  currentTestId?: string;
  mutantCoverage?: MutantCoverage;
  hitCount?: number;
  hitLimit?: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __stryker__: StrykerNamespace | undefined;
}

const g = globalThis;
const ns: StrykerNamespace = g.__stryker__ ?? {};
g.__stryker__ = ns;

const activeMutant = process.env.__STRYKER_ACTIVE_MUTANT__;
if (activeMutant !== undefined && activeMutant !== "") {
  ns.activeMutant = activeMutant;
}

const hitLimitRaw = process.env.__STRYKER_HIT_LIMIT__;
if (hitLimitRaw !== undefined && hitLimitRaw !== "") {
  const parsed = Number.parseInt(hitLimitRaw, 10);
  if (Number.isFinite(parsed)) {
    ns.hitLimit = parsed;
    ns.hitCount = ns.hitCount ?? 0;
  }
}

const coverageMode = process.env.__STRYKER_COVERAGE_ANALYSIS__;
if (coverageMode && coverageMode !== "off") {
  ns.mutantCoverage = ns.mutantCoverage ?? { static: {}, perTest: {} };
}

const reportPath = process.env.__STRYKER_REPORT_PATH__;
let flushed = false;

function flushStrykerReport(): void {
  if (flushed || !reportPath) return;
  flushed = true;
  try {
    const current = g.__stryker__;
    const payload = {
      hitCount: current?.hitCount,
      mutantCoverage: current?.mutantCoverage,
    };
    writeFileSync(reportPath, JSON.stringify(payload), "utf8");
  } catch {
    // ignore report write errors during shutdown
  }
}

process.on("beforeExit", flushStrykerReport);
process.on("exit", flushStrykerReport);
