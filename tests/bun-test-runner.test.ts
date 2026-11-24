import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StrykerOptions } from "@stryker-mutator/api/core";
import type { Logger } from "@stryker-mutator/api/logging";
import { DryRunStatus, MutantRunStatus, TestStatus } from "@stryker-mutator/api/test-runner";
import { BunTestRunner, type SpawnCommandFn } from "../src/bun-test-runner.js";
import { strykerPlugins, strykerValidationSchema } from "../src/index.js";

const noopLogger: Logger = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

function makeOptions(extra: Record<string, unknown> = {}): StrykerOptions {
  return { ...extra } as unknown as StrykerOptions;
}

describe("BunTestRunner", () => {
  const dirs: string[] = [];

  const makeDir = () => {
    const d = mkdtempSync(join(tmpdir(), "stryker-bun-test-"));
    dirs.push(d);
    return d;
  };

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("exports strykerPlugins and validation schema", () => {
    expect(strykerPlugins.length).toBe(1);
    expect(strykerPlugins[0]?.name).toBe("bun");
    expect(strykerValidationSchema).toHaveProperty("properties.bun");
  });

  test("reports reloadEnvironment capability", () => {
    const runner = new BunTestRunner(noopLogger, makeOptions());
    expect(runner.capabilities()).toEqual({ reloadEnvironment: true });
  });

  test("dryRun builds args, parses JUnit XML, and reads coverage report", async () => {
    let capturedArgs: string[] = [];
    const spawnFn: SpawnCommandFn = async (_cmd, args, env) => {
      capturedArgs = args;
      const outfileArg = args.find((a) => a.startsWith("--reporter-outfile="));
      const outfile = outfileArg?.split("=")[1] ?? "";
      writeFileSync(
        outfile,
        `<testsuite><testcase name="works" classname="suite" time="0.02"/></testsuite>`,
        "utf8",
      );
      if (env.__STRYKER_REPORT_PATH__) {
        writeFileSync(
          env.__STRYKER_REPORT_PATH__,
          JSON.stringify({ mutantCoverage: { static: { "1": 3 }, perTest: {} } }),
          "utf8",
        );
      }
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };

    const runner = new BunTestRunner(
      noopLogger,
      makeOptions({ bun: { configFile: "bunfig.toml", extraArgs: ["--dots"] } }),
      spawnFn,
      "/tmp/preload.js",
    );

    const res = await runner.dryRun({
      timeout: 5000,
      disableBail: false,
      coverageAnalysis: "all",
      testFiles: ["tests/a.test.ts"],
    });

    expect(capturedArgs).toContain("--bail=1");
    expect(capturedArgs).toContain("--preload");
    expect(capturedArgs).toContain("/tmp/preload.js");
    expect(capturedArgs).toContain("--config");
    expect(capturedArgs).toContain("bunfig.toml");
    expect(capturedArgs).toContain("--dots");
    expect(capturedArgs).toContain("tests/a.test.ts");

    expect(res.status).toBe(DryRunStatus.Complete);
    if (res.status === DryRunStatus.Complete) {
      expect(res.tests.length).toBe(1);
      expect(res.tests[0]?.status).toBe(TestStatus.Success);
      expect(res.mutantCoverage).toEqual({ static: { "1": 3 }, perTest: {} });
    }
  });

  test("mutantRun passes activeMutant, testFilter, and detects killed/survived/hitLimit/timeout", async () => {
    const mutantBase = {
      id: "42",
      fileName: "src/a.ts",
      location: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
      mutatorName: "ArithmeticOperator",
      replacement: "-",
    };

    // Killed
    const killedRunner = new BunTestRunner(
      noopLogger,
      makeOptions(),
      async (_cmd, args, env) => {
        expect(env.__STRYKER_ACTIVE_MUTANT__).toBe("42");
        expect(args).toContain("-t");
        const outfile = args.find((a) => a.startsWith("--reporter-outfile="))?.split("=")[1] ?? "";
        writeFileSync(
          outfile,
          `<testsuite><testcase name="fails" classname="s" time="0.01"><failure message="bad"/></testcase></testsuite>`,
          "utf8",
        );
        return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
      },
      "/tmp/preload.js",
    );

    const killed = await killedRunner.mutantRun({
      timeout: 5000,
      disableBail: false,
      activeMutant: mutantBase,
      sandboxFileName: "src/a.ts",
      mutantActivation: "static",
      reloadEnvironment: true,
      testFilter: ["s::fails"],
    });
    expect(killed).toMatchObject({
      status: MutantRunStatus.Killed,
      killedBy: ["s::fails"],
      failureMessage: "bad",
      nrOfTests: 1,
    });

    // Hit limit reached -> Timeout
    const hitLimitRunner = new BunTestRunner(
      noopLogger,
      makeOptions(),
      async (_cmd, _args, env) => {
        if (env.__STRYKER_REPORT_PATH__) {
          writeFileSync(env.__STRYKER_REPORT_PATH__, JSON.stringify({ hitCount: 150 }), "utf8");
        }
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      },
      "/tmp/preload.js",
    );

    const timedOutHit = await hitLimitRunner.mutantRun({
      timeout: 5000,
      disableBail: false,
      hitLimit: 100,
      activeMutant: mutantBase,
      sandboxFileName: "src/a.ts",
      mutantActivation: "runtime",
      reloadEnvironment: false,
    });
    expect(timedOutHit.status).toBe(MutantRunStatus.Timeout);

    // Process timeout
    const procTimeoutRunner = new BunTestRunner(
      noopLogger,
      makeOptions(),
      async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true }),
      "/tmp/preload.js",
    );
    const timedOutProc = await procTimeoutRunner.mutantRun({
      timeout: 100,
      disableBail: true,
      activeMutant: mutantBase,
      sandboxFileName: "src/a.ts",
      mutantActivation: "runtime",
      reloadEnvironment: false,
    });
    expect(timedOutProc.status).toBe(MutantRunStatus.Timeout);
  });

  test("executes real bun test end-to-end via BunTestRunner", async () => {
    const dir = makeDir();
    const testFile = join(dir, "sample.test.ts");
    writeFileSync(
      testFile,
      `import { expect, test } from "bun:test";
test("e2e pass", () => { expect(1 + 1).toBe(2); });
`,
      "utf8",
    );

    const runner = new BunTestRunner(
      noopLogger,
      makeOptions({ bun: { bunPath: process.execPath } }),
    );
    const res = await runner.dryRun({
      timeout: 10000,
      disableBail: false,
      coverageAnalysis: "all",
      testFiles: [testFile],
    });

    expect(res.status).toBe(DryRunStatus.Complete);
    if (res.status === DryRunStatus.Complete) {
      expect(res.tests.length).toBe(1);
      expect(res.tests[0]?.name).toContain("e2e pass");
      expect(res.tests[0]?.status).toBe(TestStatus.Success);
    }
    await runner.dispose();
  });

  test("handles dryRun timeout, error, and survived mutantRun cleanly", async () => {
    const timeoutRunner = new BunTestRunner(
      noopLogger,
      makeOptions(),
      async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true }),
      "/tmp/preload.js",
    );
    const dryTimeout = await timeoutRunner.dryRun({
      timeout: 250,
      disableBail: true,
      coverageAnalysis: "off",
    });
    expect(dryTimeout.status).toBe(DryRunStatus.Timeout);

    const errRunner = new BunTestRunner(
      noopLogger,
      makeOptions(),
      async () => ({ exitCode: 1, stdout: "", stderr: "SyntaxError", timedOut: false }),
      "/tmp/preload.js",
    );
    const dryErr = await errRunner.dryRun({
      timeout: 250,
      disableBail: false,
      coverageAnalysis: "off",
    });
    expect(dryErr).toEqual({ status: DryRunStatus.Error, errorMessage: "SyntaxError" });

    // Thrown spawn error -> Error result in both dryRun and mutantRun
    const throwRunner = new BunTestRunner(
      noopLogger,
      makeOptions({ bun: { env: { CUSTOM_VAR: "1" }, extraArgs: [] } }),
      async (_cmd, args, env) => {
        expect(args).not.toContain("--preload");
        expect(env.CUSTOM_VAR).toBe("1");
        throw new Error("ENOENT bun");
      },
      "/tmp/preload.js",
    );
    expect(
      await throwRunner.dryRun({ timeout: 250, disableBail: false, coverageAnalysis: "off" }),
    ).toEqual({ status: DryRunStatus.Error, errorMessage: "ENOENT bun" });

    const throwMutantRunner = new BunTestRunner(
      noopLogger,
      makeOptions(),
      async () => {
        throw new Error("spawn failed");
      },
      "/tmp/preload.js",
    );
    expect(
      await throwMutantRunner.mutantRun({
        timeout: 250,
        disableBail: false,
        activeMutant: {
          id: "8",
          fileName: "src/a.ts",
          location: { start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
          mutatorName: "BooleanLiteral",
          replacement: "false",
        },
        sandboxFileName: "src/a.ts",
        mutantActivation: "runtime",
        reloadEnvironment: false,
      }),
    ).toEqual({ status: MutantRunStatus.Error, errorMessage: "spawn failed" });

    const survivedRunner = new BunTestRunner(
      noopLogger,
      makeOptions(),
      async (_cmd, args) => {
        expect(args).not.toContain("--bail=1");
        const outfile = args.find((a) => a.startsWith("--reporter-outfile="))?.split("=")[1] ?? "";
        writeFileSync(
          outfile,
          `<testsuite><testcase name="passes" classname="s" time="0.01"/></testsuite>`,
          "utf8",
        );
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      },
      "/tmp/preload.js",
    );
    const survived = await survivedRunner.mutantRun({
      timeout: 5000,
      disableBail: true,
      activeMutant: {
        id: "7",
        fileName: "src/a.ts",
        location: { start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
        mutatorName: "BooleanLiteral",
        replacement: "false",
      },
      sandboxFileName: "src/a.ts",
      mutantActivation: "runtime",
      reloadEnvironment: false,
    });
    expect(survived.status).toBe(MutantRunStatus.Survived);
  });

  test("enforces timeout calculations, error fallbacks, hitLimit env, malformed reports, and dispose log", async () => {
    const debugLogs: string[] = [];
    const logger: Logger = { ...noopLogger, debug: (msg: string) => debugLogs.push(msg) };

    const timeouts: number[] = [];
    const runner = new BunTestRunner(
      logger,
      makeOptions(),
      async (_cmd, args, env, timeoutMs) => {
        timeouts.push(timeoutMs);
        expect(args).not.toContain("--config");
        expect(args).toContain(
          `--timeout=${Math.max(1, Math.ceil(timeouts.length === 1 ? 100.4 : 5000))}`,
        );
        expect(env.__STRYKER_HIT_LIMIT__).toBeUndefined();
        if (env.__STRYKER_REPORT_PATH__) {
          writeFileSync(env.__STRYKER_REPORT_PATH__, "{invalid json", "utf8");
        }
        expect(args).toContain("--preload");
        return { exitCode: 2, stdout: "  stdout err  ", stderr: "   ", timedOut: false };
      },
      "/tmp/preload.js",
    );

    const dryStdoutErr = await runner.dryRun({
      timeout: 100.4,
      disableBail: false,
      coverageAnalysis: "all",
    });
    expect(dryStdoutErr).toEqual({ status: DryRunStatus.Error, errorMessage: "stdout err" });
    expect(timeouts[0]).toBe(2100.4);

    const mutantStdoutErr = await runner.mutantRun({
      timeout: 5000,
      disableBail: false,
      activeMutant: {
        id: "42",
        fileName: "src/a.ts",
        location: { start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
        mutatorName: "BooleanLiteral",
        replacement: "false",
      },
      sandboxFileName: "src/a.ts",
      mutantActivation: "runtime",
      reloadEnvironment: false,
    });
    expect(mutantStdoutErr).toEqual({
      status: MutantRunStatus.Error,
      errorMessage: "stdout err",
    });
    expect(timeouts[1]).toBe(7000);

    const fallbackRunner = new BunTestRunner(
      logger,
      makeOptions(),
      async () => ({ exitCode: 3, stdout: "  ", stderr: "  ", timedOut: false }),
      "/tmp/preload.js",
    );
    expect(
      await fallbackRunner.dryRun({ timeout: 500, disableBail: false, coverageAnalysis: "off" }),
    ).toEqual({ status: DryRunStatus.Error, errorMessage: "bun test exited with 3" });
    expect(
      await fallbackRunner.mutantRun({
        timeout: 500,
        disableBail: false,
        activeMutant: {
          id: "9",
          fileName: "src/a.ts",
          location: { start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
          mutatorName: "BooleanLiteral",
          replacement: "false",
        },
        sandboxFileName: "src/a.ts",
        mutantActivation: "runtime",
        reloadEnvironment: false,
      }),
    ).toEqual({ status: MutantRunStatus.Error, errorMessage: "bun test exited with 3" });

    // Timeout messages and real spawn error path
    const timeoutMsgRunner = new BunTestRunner(
      logger,
      makeOptions(),
      async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true }),
      "/tmp/preload.js",
    );
    expect(
      await timeoutMsgRunner.dryRun({ timeout: 250, disableBail: false, coverageAnalysis: "off" }),
    ).toEqual({ status: DryRunStatus.Timeout, reason: "Bun test timed out after 250ms" });
    expect(
      await timeoutMsgRunner.mutantRun({
        timeout: 100,
        disableBail: false,
        activeMutant: {
          id: "42",
          fileName: "src/a.ts",
          location: { start: { line: 1, column: 0 }, end: { line: 1, column: 2 } },
          mutatorName: "BooleanLiteral",
          replacement: "false",
        },
        sandboxFileName: "src/a.ts",
        mutantActivation: "runtime",
        reloadEnvironment: false,
      }),
    ).toEqual({
      status: MutantRunStatus.Timeout,
      reason: "Mutant #42 timed out after 100ms",
    });

    const badBinRunner = new BunTestRunner(
      logger,
      makeOptions({ bun: { bunPath: "/nonexistent-bun-binary-xyz" } }),
    );
    const spawnErrRes = await badBinRunner.dryRun({
      timeout: 500,
      disableBail: false,
      coverageAnalysis: "off",
    });
    expect(spawnErrRes.status).toBe(DryRunStatus.Error);

    const prevBunPath = process.env.BUN_PATH;
    process.env.BUN_PATH = process.execPath;
    try {
      const envRunner = new BunTestRunner(
        logger,
        makeOptions({ bun: { extraArgs: ["--bail=1"] } }),
      );
      const envRes = await envRunner.dryRun({
        timeout: 1000,
        disableBail: false,
        coverageAnalysis: "off",
        testFiles: ["nonexistent-file-xyz.test.ts"],
      });
      expect(envRes.status).toBe(DryRunStatus.Error);
    } finally {
      if (prevBunPath === undefined) delete process.env.BUN_PATH;
      else process.env.BUN_PATH = prevBunPath;
    }

    await runner.dispose();
    expect(debugLogs).toEqual(["Disposed BunTestRunner"]);
  });
});
