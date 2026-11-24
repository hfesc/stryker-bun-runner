import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MutantCoverage, StrykerOptions } from "@stryker-mutator/api/core";
import type { Logger } from "@stryker-mutator/api/logging";
import { commonTokens, tokens } from "@stryker-mutator/api/plugin";
import {
  type DryRunOptions,
  type DryRunResult,
  DryRunStatus,
  determineHitLimitReached,
  type MutantRunOptions,
  type MutantRunResult,
  type TestResult,
  type TestRunner,
  type TestRunnerCapabilities,
  toMutantRunResult,
} from "@stryker-mutator/api/test-runner";
import { buildTestNameFilterRegex, parseJunitXml } from "./junit-parser.js";

export interface BunRunnerUserOptions {
  bunPath?: string;
  testFiles?: string[];
  configFile?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
}

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type SpawnCommandFn = (
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
) => Promise<SpawnResult>;

interface PreloadReport {
  hitCount?: number;
  mutantCoverage?: MutantCoverage;
}

function defaultPreloadPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const jsPath = join(here, "preload.js");
  if (existsSync(jsPath)) return jsPath;
  return join(here, "preload.ts");
}

function resolveBunBinary(configured?: string): string {
  if (configured) return configured;
  if (process.env.BUN_PATH) return process.env.BUN_PATH;
  const homeBun = join(homedir(), ".bun", "bin", "bun");
  if (existsSync(homeBun)) return homeBun;
  return "bun";
}

async function defaultSpawnCommand(
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

export class BunTestRunner implements TestRunner {
  public static readonly inject = tokens(commonTokens.logger, commonTokens.options);

  private readonly bunOptions: BunRunnerUserOptions;
  private readonly spawnFn: SpawnCommandFn;
  private readonly preloadPath: string;

  constructor(
    private readonly log: Logger,
    options: StrykerOptions,
    spawnFn: SpawnCommandFn = defaultSpawnCommand,
    preloadPath: string = defaultPreloadPath(),
  ) {
    this.bunOptions =
      ((options as Record<string, unknown>).bun as BunRunnerUserOptions | undefined) ?? {};
    this.spawnFn = spawnFn;
    this.preloadPath = preloadPath;
  }

  public capabilities(): TestRunnerCapabilities {
    return { reloadEnvironment: true };
  }

  public async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const tempDir = mkdtempSync(join(tmpdir(), "stryker-bun-"));
    const junitPath = join(tempDir, "junit.xml");
    const reportPath = join(tempDir, "stryker-report.json");

    try {
      const testFiles = options.testFiles ?? this.bunOptions.testFiles;
      const args = this.buildArgs({
        junitPath,
        timeoutMs: options.timeout,
        disableBail: options.disableBail,
        usePreload: options.coverageAnalysis !== "off",
        testFiles,
      });

      const env: Record<string, string | undefined> = {
        ...process.env,
        ...this.bunOptions.env,
        __STRYKER_COVERAGE_ANALYSIS__: options.coverageAnalysis,
        __STRYKER_REPORT_PATH__: reportPath,
      };

      const res = await this.spawnFn(
        resolveBunBinary(this.bunOptions.bunPath),
        args,
        env,
        Math.max(1000, options.timeout + 2000),
      );

      if (res.timedOut) {
        return {
          status: DryRunStatus.Timeout,
          reason: `Bun test timed out after ${options.timeout}ms`,
        };
      }

      const tests = this.readTests(junitPath);
      if (tests.length === 0 && res.exitCode !== 0) {
        return {
          status: DryRunStatus.Error,
          errorMessage:
            res.stderr.trim() || res.stdout.trim() || `bun test exited with ${res.exitCode}`,
        };
      }

      const report = this.readReport(reportPath);
      return {
        status: DryRunStatus.Complete,
        tests,
        mutantCoverage: report?.mutantCoverage,
      };
    } catch (err) {
      return {
        status: DryRunStatus.Error,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  public async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const tempDir = mkdtempSync(join(tmpdir(), "stryker-bun-mutant-"));
    const junitPath = join(tempDir, "junit.xml");
    const reportPath = join(tempDir, "stryker-report.json");

    try {
      const testFilterRegex = options.testFilter
        ? buildTestNameFilterRegex(options.testFilter)
        : undefined;
      const args = this.buildArgs({
        junitPath,
        timeoutMs: options.timeout,
        disableBail: options.disableBail,
        usePreload: true,
        testFiles: this.bunOptions.testFiles,
        testNamePattern: testFilterRegex,
      });

      const env: Record<string, string | undefined> = {
        ...process.env,
        ...this.bunOptions.env,
        __STRYKER_ACTIVE_MUTANT__: String(options.activeMutant.id),
        __STRYKER_REPORT_PATH__: reportPath,
        ...(options.hitLimit !== undefined
          ? { __STRYKER_HIT_LIMIT__: String(options.hitLimit) }
          : {}),
      };

      const res = await this.spawnFn(
        resolveBunBinary(this.bunOptions.bunPath),
        args,
        env,
        Math.max(1000, options.timeout + 2000),
      );

      if (res.timedOut) {
        return toMutantRunResult({
          status: DryRunStatus.Timeout,
          reason: `Mutant #${options.activeMutant.id} timed out after ${options.timeout}ms`,
        });
      }

      const report = this.readReport(reportPath);
      const hitLimitReached = determineHitLimitReached(report?.hitCount, options.hitLimit);
      if (hitLimitReached) {
        return toMutantRunResult(hitLimitReached);
      }

      const tests = this.readTests(junitPath);
      if (tests.length === 0 && res.exitCode !== 0) {
        return toMutantRunResult({
          status: DryRunStatus.Error,
          errorMessage:
            res.stderr.trim() || res.stdout.trim() || `bun test exited with ${res.exitCode}`,
        });
      }

      return toMutantRunResult(
        {
          status: DryRunStatus.Complete,
          tests,
        },
        options.disableBail,
      );
    } catch (err) {
      return toMutantRunResult({
        status: DryRunStatus.Error,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  public async dispose(): Promise<void> {
    this.log.debug("Disposed BunTestRunner");
  }

  private buildArgs(params: {
    junitPath: string;
    timeoutMs: number;
    disableBail: boolean;
    usePreload: boolean;
    testFiles?: string[];
    testNamePattern?: string;
  }): string[] {
    const args: string[] = [
      "test",
      "--reporter=junit",
      `--reporter-outfile=${params.junitPath}`,
      `--timeout=${params.timeoutMs}`,
    ];

    if (!params.disableBail) {
      args.push("--bail=1");
    }
    if (params.usePreload) {
      args.push("--preload", this.preloadPath);
    }
    if (this.bunOptions.configFile) {
      args.push("--config", this.bunOptions.configFile);
    }
    if (params.testNamePattern) {
      args.push("-t", params.testNamePattern);
    }
    if (this.bunOptions.extraArgs && this.bunOptions.extraArgs.length > 0) {
      args.push(...this.bunOptions.extraArgs);
    }
    if (params.testFiles && params.testFiles.length > 0) {
      args.push(...params.testFiles);
    }

    return args;
  }

  private readTests(junitPath: string): TestResult[] {
    if (!existsSync(junitPath)) return [];
    const xml = readFileSync(junitPath, "utf8");
    return parseJunitXml(xml);
  }

  private readReport(reportPath: string): PreloadReport | undefined {
    if (!existsSync(reportPath)) return undefined;
    try {
      return JSON.parse(readFileSync(reportPath, "utf8")) as PreloadReport;
    } catch {
      return undefined;
    }
  }
}
