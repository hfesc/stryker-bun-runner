# stryker-bun-runner

A fast, native **StrykerJS `TestRunner` plugin for `bun test`** with the performance and ergonomics of the Vitest/Jest runners.

## Features

- **Native JUnit XML parsing** (`bun test --reporter=junit`) -> per-test `TestResult[]` with timing, file names, and failure messages
- **Fail-fast bail** (`--bail=1` when `disableBail: false`) to abort mutant runs on the first killing test
- **Test filtering** (`-t <regex>`) when `testFilter` is provided
- **Static & runtime mutant activation** via `--preload` (`globalThis.__stryker__.activeMutant` initialized before module evaluation)
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

### Options (`bun`)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `bunPath` | `string` | `"bun"` (or `BUN_PATH` / `~/.bun/bin/bun`) | Path to the `bun` executable |
| `testFiles` | `string[]` | `undefined` | Specific test files or directories passed to `bun test` |
| `configFile` | `string` | `undefined` | Path to `bunfig.toml` passed via `--config` |
| `extraArgs` | `string[]` | `undefined` | Extra CLI flags appended to `bun test` |
| `env` | `Record<string, string>` | `undefined` | Additional environment variables for test runs |

## Architecture

See [docs/architecture.md](docs/architecture.md) for details on the DryRun/MutantRun lifecycle, `--preload` mutant activation, and JUnit XML parsing.

## Development & Harness

```bash
bun run harness        # typecheck + biome lint + tsc build + bun test
bun run test:coverage  # bun test with coverage report
bun run mutate         # StrykerJS mutation testing (threshold >= 65%)
bun run release:dry    # Dry-run semantic release with release-it
```

## Releases

Semantic versioning is automated with `release-it` and `@release-it/conventional-changelog` (`conventionalcommits`).
Trigger a release locally with `bun run release` or on GitHub Actions via the **Release** (`workflow_dispatch`) workflow.

## License

[MIT](LICENSE)
