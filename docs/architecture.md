# Architecture

`stryker-bun-runner` implements StrykerJS v10's `TestRunner` plugin contract for `bun test` while keeping Node.js worker compatibility inside StrykerJS.

## Lifecycle

1. **Plugin Discovery (`src/index.ts`)**
   - Exports `strykerPlugins` (`declareClassPlugin(PluginKind.TestRunner, "bun", BunTestRunner)`) and `strykerValidationSchema` (`src/schema.json`).
   - StrykerJS injects `Logger` and `StrykerOptions` via `typed-inject` (`commonTokens.logger`, `commonTokens.options`).

2. **Dry Run (`BunTestRunner.dryRun`)**
   - Allocates an isolated temporary directory for JUnit XML (`--reporter=junit --reporter-outfile`) and coverage JSON (`__STRYKER_REPORT_PATH__`).
   - Spawns `bun test` with `--timeout`, optional `--bail=1` (when `disableBail: false`), optional `--preload dist/preload.js` (when `coverageAnalysis !== "off"`), and optional `testFiles`.
   - Parses JUnit XML into Stryker `TestResult[]` (`Success`, `Failed`, `Skipped`) and attaches `mutantCoverage`.

3. **Mutant Run (`BunTestRunner.mutantRun`)**
   - Sets `__STRYKER_ACTIVE_MUTANT__` and `__STRYKER_HIT_LIMIT__` in the child environment.
   - Always loads `dist/preload.js` via `--preload` so `globalThis.__stryker__` is initialized **before** any test or SUT module is imported (supporting both `"runtime"` and `"static"` `mutantActivation`).
   - When `testFilter` is provided (from `perTest` coverage analysis), converts test IDs into an escaped regex passed to `bun test -t <pattern>`.
   - Uses `--bail=1` when `disableBail: false` to abort on the first killing test.
   - Evaluates `determineHitLimitReached(hitCount, hitLimit)` for infinite-loop protection, then maps results with `toMutantRunResult`.

4. **Preload Hook (`src/preload.ts`)**
   - Initializes `globalThis.__stryker__` (`activeMutant`, `hitLimit`, `hitCount`, `mutantCoverage`).
   - Flushes `{ hitCount, mutantCoverage }` to `__STRYKER_REPORT_PATH__` on `beforeExit` / `exit`.
