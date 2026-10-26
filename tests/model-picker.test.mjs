import test from "node:test";
import assert from "node:assert/strict";
import { pickModel } from "../src/cli-pickers.mjs";

test("pickModel walks provider then model, and Esc on models returns to providers", async () => {
  const config = { providers: { mock: { api: "openai", baseURL: "http://127.0.0.1:9/v1", keyEnv: null, apiKey: "k", defaultModel: "one", models: ["two"] } } };
  const answers = [{ value: "mock" }, null, { value: "mock" }, "pick-two"];
  const titles = [];
  const ui = {
    toast() {},
    ask: async () => "",
    async select({ title, items }) {
      titles.push(title);
      const next = answers.shift();
      if (next !== "pick-two") return next;
      const list = await items;
      return list.find((i) => i.value === "two");
    },
  };
  const spec = await pickModel({ ui, config, activeSpec: "mock/one", lang: "en" });
  assert.equal(spec, "mock/two");
  assert.deepEqual(titles, ["Model · provider", "mock · model", "Model · provider", "mock · model"]);
});
