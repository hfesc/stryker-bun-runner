import { describe, expect, test } from "bun:test";
import { TestStatus } from "@stryker-mutator/api/test-runner";
import { buildTestNameFilterRegex, parseJunitXml } from "../src/junit-parser.js";

describe("parseJunitXml", () => {
  test("parses passed, failed, and skipped testcases with entity decoding", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="tests/math.test.ts" tests="3" failures="1" skipped="1">
    <testcase name="adds &amp; multiplies" classname="math &gt; ops" time="0.012" file="tests/math.test.ts" />
    <testcase name="divides by zero" classname="math" time="0.005">
      <failure message="Expected &quot;Infinity&quot; to be 0">AssertionError: expected Infinity</failure>
    </testcase>
    <testcase name="pending test" classname="math" time="0">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`;

    const results = parseJunitXml(xml);
    expect(results).toEqual([
      {
        id: "math > ops::adds & multiplies",
        name: "math > ops > adds & multiplies",
        status: TestStatus.Success,
        timeSpentMs: 12,
        fileName: "tests/math.test.ts",
      },
      {
        id: "math::divides by zero",
        name: "math > divides by zero",
        status: TestStatus.Failed,
        timeSpentMs: 5,
        fileName: undefined,
        failureMessage: 'Expected "Infinity" to be 0\nAssertionError: expected Infinity',
      },
      {
        id: "math::pending test",
        name: "math > pending test",
        status: TestStatus.Skipped,
        timeSpentMs: 0,
        fileName: undefined,
      },
    ]);
  });

  test("handles error tags and self-closing failures", () => {
    const xml = `<testsuite><testcase name="boom" time="0.1"><error message="Crash" /></testcase></testsuite>`;
    const results = parseJunitXml(xml);
    expect(results).toEqual([
      {
        id: "boom",
        name: "boom",
        status: TestStatus.Failed,
        timeSpentMs: 100,
        fileName: undefined,
        failureMessage: "Crash",
      },
    ]);
  });
});

describe("buildTestNameFilterRegex", () => {
  test("builds escaped alternation regex from test ids", () => {
    expect(buildTestNameFilterRegex([])).toBeUndefined();
    expect(buildTestNameFilterRegex(["suite::adds (1+2)", "plain [test]"])).toBe(
      "adds \\(1\\+2\\)|plain \\[test\\]",
    );
  });
});
