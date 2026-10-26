import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus, createRunContext } from "../src/runtime/events.mjs";

test("model.usage keeps only token counts and totals them per run", () => {
  const bus = createEventBus();
  const context = createRunContext({ bus });
  bus.emit(context, "run.started", { model: "mock/m" });
  bus.emit(context, "model.usage", { inputTokens: 1200, outputTokens: 80, prompt: "SECRET" });
  bus.emit(context, "model.usage", { inputTokens: 1500.4, outputTokens: 20 });
  const run = bus.snapshot().runs[context.runId];
  assert.equal(run.inputTokens, 1500);
  assert.equal(run.outputTokens, 100);
  assert.doesNotMatch(JSON.stringify(bus.replay(0)), /SECRET/);
});
