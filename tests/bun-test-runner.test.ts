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
    expect(killed.status).toBe(MutantRunStatus.Killed);

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
});
