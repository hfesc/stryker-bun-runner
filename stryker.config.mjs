/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "command",
  commandRunner: {
    command: "bun test",
  },
  mutate: ["src/**/*.ts", "!src/index.ts", "!src/preload.ts"],
  coverageAnalysis: "off",
  concurrency: 4,
  timeoutMS: 10000,
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    high: 80,
    low: 65,
    break: 65,
  },
};
