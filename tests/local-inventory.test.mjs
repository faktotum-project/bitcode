import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { diskModels, fitFor } from "../src/local-inventory.mjs";

const GB = 1024 ** 3;
const machine = (ram, gpus = []) => ({ ram: { total: ram, available: ram * 0.8 }, gpus, cpus: 8 });

test("fitFor prefers dedicated GPU memory, then free RAM, and flags models too large for the machine", () => {
  const nvidia = [{ vendor: "nvidia", vram: 24 * GB, unified: false }];
  assert.equal(fitFor(8 * GB, machine(64 * GB, nvidia)).fit, "gpu");
  assert.equal(fitFor(30 * GB, machine(64 * GB, nvidia)).fit, "ram");
  assert.equal(fitFor(13 * GB, machine(32 * GB, [{ vendor: "amd", vram: 3 * GB, unified: true }])).fit, "ram");
  assert.equal(fitFor(22 * GB, machine(32 * GB)).fit, "tight");
  assert.equal(fitFor(60 * GB, machine(32 * GB)).fit, "too-big");
  assert.equal(fitFor(0, machine(32 * GB)).fit, "unknown");
});

test("diskModels finds models downloaded by Ollama, LM Studio, llama.cpp and Hugging Face", () => {
  const home = mkdtempSync(path.join(tmpdir(), "bitcode-inv-"));
  const manifest = path.join(home, ".ollama/models/manifests/registry.ollama.ai/library/qwen3/8b");
  mkdirSync(path.dirname(manifest), { recursive: true });
  writeFileSync(manifest, JSON.stringify({ layers: [{ size: 5 * GB }, { size: 1000 }] }));
  const lms = path.join(home, ".lmstudio/models/lmstudio-community/Mistral-GGUF");
  mkdirSync(lms, { recursive: true });
  writeFileSync(path.join(lms, "mistral-7b-Q4_K_M.gguf"), "x".repeat(10));
  writeFileSync(path.join(lms, "mmproj-model.gguf"), "x");
  mkdirSync(path.join(home, "models"), { recursive: true });
  writeFileSync(path.join(home, "models", "phi-4.gguf"), "x".repeat(20));
  const snap = path.join(home, ".cache/huggingface/hub/models--org--tiny/snapshots/abc");
  mkdirSync(snap, { recursive: true });
  writeFileSync(path.join(snap, "model.safetensors"), "x".repeat(30));
  const found = diskModels({ home });
  const by = name => found.find(f => f.name === name);
  assert.equal(by("qwen3:8b").runtime, "ollama");
  assert.equal(by("qwen3:8b").size, 5 * GB + 1000);
  assert.equal(by("mistral-7b-Q4_K_M").runtime, "lmstudio");
  assert.ok(!found.some(f => /mmproj/.test(f.name)), "vision projectors are not models");
  assert.equal(by("phi-4").runtime, "llamacpp");
  assert.equal(by("org/tiny").format, "safetensors");
});
