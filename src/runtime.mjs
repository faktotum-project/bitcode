import { AsyncLocalStorage } from "node:async_hooks";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

const options = { allErrors: true, strict: false, validateFormats: false, ownProperties: true };
const validators = [new Ajv(options), new Ajv2020(options)];
const cache = new WeakMap();

export function validateArgs(tool, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("tool arguments must be a JSON object");
  const schema = tool.parameters || { type: "object" };
  let validate = cache.get(schema);
  if (!validate) {
    const ajv = validators[schema.$schema?.includes("2020-12") ? 1 : 0];
    validate = ajv.compile(schema);
    cache.set(schema, validate);
  }
  if (!validate(args)) throw new Error(`invalid arguments: ${validators[0].errorsText(validate.errors, { dataVar: "args" })}`);
}

export function formatResult(value, maxChars = 50_000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return text.length <= maxChars ? text : text.slice(0, maxChars) + `\n[truncated ${text.length - maxChars} characters; narrow the request]`;
}

export function isMutating(tool) { return tool?.mutating !== false || tool?.financial === true; }

export function throwIfAborted(signal) { signal?.throwIfAborted(); }

export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

const toolContext = new AsyncLocalStorage();
export const withToolContext = (context, run) => toolContext.run(context, run);
export const currentToolSignal = () => toolContext.getStore()?.signal;
