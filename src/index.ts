import { readFileSync } from "node:fs";
import { declareClassPlugin, PluginKind } from "@stryker-mutator/api/plugin";
import { BunTestRunner } from "./bun-test-runner.js";

export const strykerPlugins = [declareClassPlugin(PluginKind.TestRunner, "bun", BunTestRunner)];

export const strykerValidationSchema: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./schema.json", import.meta.url), "utf8"),
);

export {
  type BunRunnerUserOptions,
  BunTestRunner,
  type SpawnCommandFn,
  type SpawnResult,
} from "./bun-test-runner.js";
export { buildTestNameFilterRegex, parseJunitXml } from "./junit-parser.js";
