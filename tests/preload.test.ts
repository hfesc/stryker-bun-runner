import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("preload", () => {
  const dirs: string[] = [];

  const makeDir = () => {
    const d = mkdtempSync(join(tmpdir(), "stryker-bun-preload-"));
    dirs.push(d);
    return d;
  };

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("initializes globalThis.__stryker__ and flushes hitCount and mutantCoverage on exit", () => {
    const dir = makeDir();
    const reportPath = join(dir, "report.json");

    const script = `
      const s = globalThis.__stryker__;
      if (s.activeMutant !== "99") throw new Error("bad activeMutant");
      if (s.hitLimit !== 500) throw new Error("bad hitLimit");
      s.hitCount = 12;
      s.mutantCoverage.static["99"] = 4;
    `;

    const res = Bun.spawnSync([process.execPath, "--preload", "./src/preload.ts", "-e", script], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        __STRYKER_ACTIVE_MUTANT__: "99",
        __STRYKER_HIT_LIMIT__: "500",
        __STRYKER_COVERAGE_ANALYSIS__: "all",
        __STRYKER_REPORT_PATH__: reportPath,
      },
    });

    expect(res.exitCode).toBe(0);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report).toEqual({
      hitCount: 12,
      mutantCoverage: { static: { "99": 4 }, perTest: {} },
    });
  });
});
