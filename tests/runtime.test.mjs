import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArgs, formatResult } from "../src/runtime.mjs";
import { agentLimits } from "../src/agent.mjs";

test("tool schemas reject missing fields, incorrect types and extra arguments", () => {
  const tool = { parameters: { type: "object", properties: { amount: { type: "integer", minimum: 1 } }, required: ["amount"], additionalProperties: false } };
  for (const args of [{}, { amount: "1" }, { amount: -1 }, { amount: 1.5 }, { amount: 1, extra: true }, [], null]) assert.throws(() => validateArgs(tool, args));
  assert.doesNotThrow(() => validateArgs(tool, { amount: 2 }));
});
test("schema validation handles refs, unions and 2020-12 schemas", () => {
  const tool = { parameters: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", $defs: { id: { type: "string", minLength: 2 } }, properties: { id: { $ref: "#/$defs/id" }, mode: { enum: ["safe", "fast"] } }, required: ["id"] } };
  validateArgs(tool, { id: "ok" });
  assert.throws(() => validateArgs(tool, { id: "x" }));
  assert.throws(() => validateArgs(tool, { id: "ok", mode: "unknown" }));
});
test("results preserve structured objects and enforce output limits", () => {
  assert.match(formatResult({ ok: true }), /"ok": true/);
  assert.match(formatResult("abcdef", 3), /^abc\n\[truncated 3/);
});
test("limits reject non-finite, fractional and invalid values", () => {
  const limits = agentLimits({ agent: { maxSteps: Infinity, maxParallelTools: 0, maxTotalToolCalls: -2, maxRetries: 2 } });
  assert.equal(limits.maxSteps, 50); assert.equal(limits.maxParallelTools, 4);
  assert.equal(limits.maxTotalToolCalls, 200); assert.equal(limits.toolRetryAttempts, 2);
});
