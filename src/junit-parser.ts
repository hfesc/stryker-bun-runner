import { type TestResult, TestStatus } from "@stryker-mutator/api/test-runner";

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}="([^"]*)"`);
  const match = attrs.match(re);
  return match?.[1] !== undefined ? decodeXmlEntities(match[1]) : undefined;
}

function extractFailureMessage(body: string): string {
  const tagMatch = body.match(/<(?:failure|error)\b([^>]*)>([\s\S]*?)<\/(?:failure|error)>/);
  if (tagMatch) {
    const msgAttr = getAttr(tagMatch[1] ?? "", "message");
    const inner = decodeXmlEntities((tagMatch[2] ?? "").trim());
    if (msgAttr && inner && inner !== msgAttr) return `${msgAttr}\n${inner}`;
    return msgAttr || inner || "Test failed";
  }
  const selfClosing = body.match(/<(?:failure|error)\b([^>]*)\/>/);
  if (selfClosing) {
    return getAttr(selfClosing[1] ?? "", "message") || "Test failed";
  }
  return "Test failed";
}

export function parseJunitXml(xml: string): TestResult[] {
  const results: TestResult[] = [];
  const testcaseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;

  for (const match of xml.matchAll(testcaseRe)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";

    const rawName = getAttr(attrs, "name") ?? "unnamed";
    const classname = getAttr(attrs, "classname") ?? "";
    const fileName = getAttr(attrs, "file") ?? (classname.includes(".") ? classname : undefined);
    const timeSec = Number.parseFloat(getAttr(attrs, "time") ?? "0");
    const timeSpentMs = Number.isFinite(timeSec) ? Math.round(timeSec * 1000) : 0;

    const id = classname ? `${classname}::${rawName}` : rawName;
    const name = classname ? `${classname} > ${rawName}` : rawName;

    if (/<skipped\b/.test(body)) {
      results.push({
        id,
        name,
        status: TestStatus.Skipped,
        timeSpentMs,
        fileName,
      });
    } else if (/<(?:failure|error)\b/.test(body)) {
      results.push({
        id,
        name,
        status: TestStatus.Failed,
        timeSpentMs,
        fileName,
        failureMessage: extractFailureMessage(body),
      });
    } else {
      results.push({
        id,
        name,
        status: TestStatus.Success,
        timeSpentMs,
        fileName,
      });
    }
  }

  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildTestNameFilterRegex(testIds: string[]): string | undefined {
  if (testIds.length === 0) return undefined;
  const names = testIds
    .map((id) => {
      const idx = id.indexOf("::");
      return idx >= 0 ? id.slice(idx + 2) : id;
    })
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  return names.map(escapeRegex).join("|");
}
