# stryker-bun-runner

A fast, native **StrykerJS `TestRunner` plugin for `bun test`** with the performance features of the Vitest/Jest runners.

## Features

- **Native JUnit XML parsing** (`bun test --reporter=junit`) -> per-test `TestResult[]` with timing and failure messages
- **Fail-fast bail** (`--bail=1` when `disableBail: false`) to abort mutant runs on the first failing test
- **Test filtering** (`-t <regex>`) when `testFilter` is provided
- **Static & runtime mutant activation** via `--preload` (`globalThis.__stryker__.activeMutant` before module evaluation)
- **Infinite-loop protection** via `hitLimit` / `hitCount` reporting
- **Coverage collection** (`coverageAnalysis: "all"` / `"perTest"`)
- **Full environment reload** (`reloadEnvironment: true`)

## Installation

```bash
bun add -d stryker-bun-runner @stryker-mutator/core
```

## Configuration (`stryker.config.mjs`)

```js
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  plugins: ["stryker-bun-runner"],
  testRunner: "bun",
  coverageAnalysis: "all",
  bun: {
    // Optional overrides:
    // bunPath: "bun",
    // testFiles: ["tests/unit"],
    // configFile: "bunfig.toml",
    // extraArgs: ["--dots"],
    // env: { NODE_ENV: "test" },
  },
};
```

## Development

```bash
bun run harness   # typecheck + biome lint + tsc build + bun test
```
