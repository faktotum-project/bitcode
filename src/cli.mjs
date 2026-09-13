import { bitcodeHome } from "./paths.mjs";
// Command-line interface: argument parsing, interactive REPL, and one-shot mode.
// Visual styling comes from the bitcode design system via ./theme.mjs.

import readline from "node:readline";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, resolveModel, allProviders, configPath, configGet, configSet, saveConfig } from "./config.mjs";
import { providerRows, providerAdd, providerLogin } from "./settings.mjs";
import { providerHealth } from "./providers.mjs";
import { loadPlugins } from "./plugins.mjs";
import { dependencyReport } from "./diagnostics.mjs";
import { VERSION } from "./version.mjs";
import { closeCashuDaemons } from "./cashu/mint.mjs";
import { closeProcesses } from "./processes.mjs";
import { loadSkills, contextPrompt, contextStats, compactContext } from "./context.mjs";
import { savePlan, latestPlan } from "./plans.mjs";
import { isMutating } from "./runtime.mjs";
import { closeMcpConnections, mcpTools } from "./mcp.mjs";
import { closeWavelength, wavelengthTools } from "./wavelength/tools.mjs";
import { emit } from "./hooks.mjs";
import { runAgent, systemPrompt, agentLimits } from "./agent.mjs";
import { buildTools, registerTool } from "./tools.mjs";
import { resolveNetwork } from "./bitcoin/network.mjs";
import { wallet } from "./bitcoin/wallet.mjs";
import { loadCommands, expandCommand } from "./commands.mjs";
import { loadAgents, findAgent, agentsDir } from "./agents.mjs";
import { expandMentions } from "./mentions.mjs";
import { readLine, question } from "./tui.mjs";
import {
  saveSession,
  loadSession,
  listSessions,
  latestSession,
  newSessionId,
  exportSession,
} from "./session.mjs";
import * as t from "./theme.mjs";

function out(s = "") {
  process.stdout.write(s + "\n");
}

// ---- persistent REPL history (~/.bitcode/history) ----

function historyPath() {
  return path.join(bitcodeHome(), "history");
}

function loadHistory() {
  try {
    return readFileSync(historyPath(), "utf8").split("\n").filter(Boolean).slice(-1000);
  } catch {
    return [];
  }
}

function appendHistory(line) {
  try {
    const file = historyPath();
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, line + "\n");
  } catch {
    // history is best-effort; never let it break the REPL
  }
}

// ---- slash-command dropdown (feeds tui.readLine's `menu`) ----

const SLASH_COMMANDS = [
  { name: "help", hint: "show commands" },
  { name: "plan", hint: "investigate a task with read-only tools and save a plan", args: true },
  { name: "build", hint: "execute the most recently saved plan" },
  { name: "compact", hint: "summarize older context, keeping recent turns" },
  { name: "status", hint: "context size, token usage and task progress" },
  { name: "skills", hint: "list local skills" },
  { name: "mcp", hint: "show MCP connections" },
  { name: "commands", hint: "list bundled and custom commands" },
  { name: "model", hint: "show or switch the active model", args: true },
  { name: "models", hint: "pick a model from a list" },
  { name: "setting", hint: "provider status & active model" },
  { name: "config", hint: "get · set config values", args: true },
  { name: "provider", hint: "add an API key · list providers", args: true },
  { name: "login", hint: "configure a provider with a masked API key", args: true },
  { name: "doctor", hint: "config, provider, tools & plugin diagnostics" },
  { name: "session", hint: "save · load · list · export", args: true },
  { name: "subagent", hint: "delegate a sub-task to a persona", args: true },
  { name: "tools", hint: "list available tools" },
  { name: "reset", hint: "clear conversation history" },
  { name: "exit", hint: "leave" },
];

// menu(buf) → rows while typing a bare "/command" (hidden once an argument
// starts). No-arg commands submit on Enter; the rest complete with a trailing
// space so you can type their argument.
function buildMenu(commands) {
  const all = [
    ...SLASH_COMMANDS,
    ...commands.map((c) => ({ name: c.name, hint: c.description || "custom command", args: true })),
  ];
  return (buf) => {
    if (!buf.startsWith("/") || /\s/.test(buf)) return null;
    const q = buf.slice(1).toLowerCase();
    const rows = all.filter((c) => c.name.toLowerCase().startsWith(q));
    if (!rows.length) return null;
    return rows.map((c) => ({
      label: "/" + c.name,
      hint: c.hint,
      insert: c.args ? `/${c.name} ` : `/${c.name}`,
      submit: !c.args,
    }));
  };
}

const HELP = `${t.accent(t.BOLT)}${t.BOLT ? " " : ""}${t.bold("bitcode")} — minimal multi-provider terminal coding agent

Usage:
  bitcode [options]                  start interactive session
  bitcode [options] "<prompt>"       one-shot: run a single request and exit
  bitcode -p "<prompt>"              same as above (explicit)
  bitcode models                     list known providers and default models
  bitcode login [provider]            choose a provider and save a masked API key
  bitcode tools|commands|skills       inspect available capabilities (supports --json)
  bitcode provider list|health        inspect provider configuration/connectivity
  bitcode session list                list saved sessions
  bitcode mcp                         inspect MCP connections
  bitcode config                     print the config file path
  bitcode doctor                     print a diagnostics report
  bitcode wallet seed                reveal the wallet's mnemonic (human only)

Options:
  -m, --model <provider>/<model>     model to use (e.g. ollama/gpt-oss:20b,
                                     anthropic/claude-sonnet-4-6). Defaults to
                                     BITCODE_MODEL, config "model", or a built-in.
  -p, --print <prompt>               one-shot mode (auto-approves tools)
      --resume [id]                  resume a saved session (latest if no id)
      --continue                     resume the most recent session
      --cwd <path>                   run in this working directory
      --read-only                    expose only read-only tools
      --json                         one-shot JSON result (answer, usage, events)
      --max-steps <n>                bound the number of model rounds
      --allow-payments               explicitly authorize financial tools in one-shot mode
      --yolo                         skip ordinary mutation approvals (payments still ask)
  -h, --help                         show this help
  -v, --version                      show version

Interactive slash commands:
  /help                show commands
  /plan <task>         investigate with read-only tools and save a plan
  /build               execute the latest saved plan
  /compact             summarize older context
  /status              context and token usage
  /skills /mcp /commands  inspect extensions and commands
  /model [spec]        show or switch the active model
  /models              pick a model interactively from a numbered list
  /setting             provider key status + active model + config path
  /config <sub>        get [key] · set <key> <value>  (persisted, chmod 600)
  /provider <sub>      add <name> (masked key entry) · list · health
  /login [provider]    choose a provider and save a masked API key
  /session <sub>       save [name] · load <id> · list · export [md|json]
  /subagent [name] [prompt]
                       list personas (~/.bitcode/agents/*.md), or delegate
                       a sub-task to one and print just its final answer
  /tools               list available tools
  /reset               clear conversation history
  /exit, /quit         leave

Custom commands: any ~/.bitcode/commands/<name>.md becomes its own /<name>.

Config: ${configPath()}
`;

export function parseArgs(argv) {
  const opts = { yolo: false, print: false, model: null, prompt: null, command: null, resume: null };
  const positionals = [];
  const value = (i, flag) => { const v = argv[i]; if (!v || v.startsWith("--")) throw new Error(`${flag} requires a value`); return v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { positionals.push(...argv.slice(i + 1)); break; }
    if (a === "-h" || a === "--help") return { help: true };
    if (a === "-v" || a === "--version") return { version: true };
    if (a === "--yolo") opts.yolo = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--read-only") opts.readOnly = true;
    else if (a === "--allow-payments") opts.allowPayments = true;
    else if (a === "--cwd") opts.cwd = value(++i, a);
    else if (a === "--max-steps") { opts.maxSteps = Number(value(++i, a)); if (!Number.isSafeInteger(opts.maxSteps) || opts.maxSteps < 1) throw new Error("--max-steps must be a positive integer"); }
    else if (a === "--continue") opts.resume = "latest";
    else if (a === "--resume") opts.resume = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : "latest";
    else if (a === "-m" || a === "--model") opts.model = value(++i, a);
    else if (a === "-p" || a === "--print") { opts.print = true; opts.prompt = value(++i, a); }
    else if (a.startsWith("-")) throw new Error(`unknown option: ${a}`);
    else if (!opts.command && !opts.prompt && !positionals.length && ["models", "config", "doctor", "wallet", "tools", "commands", "skills", "mcp", "provider", "login", "session"].includes(a)) {
      opts.command = a;
      if (a === "wallet") opts.walletSub = argv[++i];
    } else positionals.push(a);
  }
  if (opts.command) opts.commandArgs = positionals;
  else if (!opts.prompt && positionals.length) opts.prompt = positionals.join(" ");
  if (opts.command === "login" && (positionals.length > 1 || opts.json || opts.prompt)) throw new Error("usage: bitcode login [provider]; enter the API key only at the prompt");
  if (opts.json && !opts.prompt && !opts.command) throw new Error("--json requires a one-shot prompt or command");
  return opts;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.cwd) process.chdir(opts.cwd);
  if (opts.help) return out(HELP);
  if (opts.version) return out(`${t.accent(t.BOLT)}${t.BOLT ? " " : ""}bitcode ${VERSION}`);

  const config = loadConfig();

  if (opts.command === "login") {
    const result = await providerLogin(config, opts.commandArgs[0], { print: out });
    out(result.ok ? t.ok(result.msg) : t.danger(result.msg));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (opts.command === "config") return out(configPath());
  if (opts.command === "models") return opts.json ? printData(redact(allProviders(config)), opts) : printModels(config);
  if (opts.command === "wallet") return walletCommand(opts.walletSub, config);
  if (opts.command === "commands") return printData(loadCommands().map(({ name, description }) => ({ name, description })), opts);
  if (opts.command === "skills") return printData(loadSkills(), opts);
  if (opts.command === "session" && ![undefined, "list"].includes(opts.commandArgs?.[0])) throw new Error("use /session in interactive mode for save/load/export, or --resume for one-shot continuation");
  if (opts.command === "session" && opts.json) return printData(listSessions(process.cwd()), opts);
  if (opts.command === "provider" && opts.json && [undefined, "list"].includes(opts.commandArgs?.[0])) return printData(redact(allProviders(config)), opts);
  if (opts.command === "provider" || opts.command === "session") return handleSlash(`/${opts.command} ${(opts.commandArgs || []).join(" ")}`, { config, cwd: process.cwd(), session: {}, messages: [], network: resolveNetwork(config).name, getActive: () => resolveModel({ config }), setActive: () => {}, ask: question });
  if (["doctor", "tools", "mcp"].includes(opts.command)) {
    const ext = await loadExtensions(config);
    try {
      const tools = buildTools(config, {});
      if (opts.command === "tools") return printData(tools.map(({ name, description, parameters, mutating }) => ({ name, description, parameters, mutating })), opts);
      if (opts.command === "mcp") return printData(ext.mcpServers, opts);
      const lines = doctorLines(config, { toolCount: tools.length, ...ext });
      return opts.json ? printData({ version: VERSION, node: process.version, tools: tools.length, dependencies: dependencyReport(config), ...ext }, opts) : lines.forEach(out);
    } finally { await closeMcpConnections(); await closeWavelength(); }
  }

  let target;
  try {
    target = resolveModel({ cliModel: opts.model, config });
  } catch (err) {
    out(t.danger(`config error: ${err.message}`));
    process.exit(1);
  }

  const ctx = resolveNetwork(config);
  const skills = loadSkills();
  const system = systemPrompt({ network: ctx.name, lightning: !!config.lightning?.lndRestUrl }) + "\n\n" + contextPrompt(process.cwd(), skills);
  const agents = loadAgents();
  const modelRef = { current: target };
  const ext = await loadExtensions(config); // plugins + MCP register their tools first
  const plan = { steps: [] };
  let tools;
  try { tools = buildTools(config, { modelRef, agents, system, skills, plan }); }
  catch (err) { await closeMcpConnections(); await closeWavelength(); throw err; }

  const limits = agentLimits(config);
  if (opts.maxSteps) limits.maxSteps = opts.maxSteps;
  const fallbacks = resolveFallbacks(config);

  try {
    if (opts.prompt) return await oneShot({ target, system, tools, network: ctx.name, prompt: opts.prompt, limits, fallbacks, opts });
    const commands = loadCommands();
    await interactive({ target, system, tools, network: ctx.name, config, yolo: opts.yolo, agents, commands, modelRef, resume: opts.resume, limits, fallbacks, ext, readOnly: opts.readOnly, plan, maxStepsOverride: opts.maxSteps });
  } finally { await closeProcesses(); await closeCashuDaemons(); await closeMcpConnections(); await closeWavelength(); }
}

// ---- wallet command (human-only; never exposed as an agent tool) ----

async function walletCommand(sub, config) {
  const ctx = resolveNetwork(config);
  const w = wallet(ctx);

  if (sub === "seed") {
    if (!w.exists()) {
      out(t.danger(`no ${ctx.name} wallet at ${w.file}. Run the agent's wallet_create tool first.`));
      process.exit(1);
    }
    out(t.danger("This reveals your wallet's secret recovery phrase."));
    out(t.danger("Anyone who sees it can steal every coin this wallet holds or will ever hold."));
    out("");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((resolve) =>
      rl.question(`Type "${ctx.name}" to confirm you want to display it: `, resolve),
    );
    rl.close();
    if (ans.trim() !== ctx.name) {
      out(t.faint("aborted"));
      return;
    }
    out("");
    out(t.label(`${ctx.name} wallet seed`));
    out(w.revealMnemonic());
    out("");
    return;
  }

  out(t.danger(`unknown wallet subcommand: ${sub || "(none)"}`));
  out(t.faint("usage: bitcode wallet seed"));
  process.exit(1);
}

// One entry per known provider: { spec, name, line } where `spec` is the
// default-model spec ("provider/model") ready to hand to resolveModel().
// Shared by `bitcode models` and the interactive /models picker.
function providerLines(config) {
  const providers = allProviders(config);
  return Object.entries(providers).map(([name, p]) => {
    const key = p.keyEnv
      ? p.keyEnv + (process.env[p.keyEnv] ? " " + t.ok("✓") : t.faint(" (unset)"))
      : t.faint("local");
    const line =
      `${t.accent(name)}  ${t.faint(`[${p.api}]`)}  ${t.body("default:")} ${p.defaultModel || "-"}  ${key}\n` +
      "  " + t.faint(`  ${p.baseURL}`);
    return { spec: p.defaultModel ? `${name}/${p.defaultModel}` : name, name, line };
  });
}

// Load user extensions: plugins (~/.bitcode/plugins/*.mjs) and MCP servers
// (config.mcp). Both register their tools into the shared registry so a later
// buildTools() picks them up. Returns diagnostics for /doctor.
async function loadExtensions(config) {
  const plugins = await loadPlugins();
  const { tools: mcp, servers: mcpServers } = await mcpTools(config);
  for (const tool of mcp) registerTool(tool);
  const wavelength = await wavelengthTools(config);
  for (const tool of wavelength) registerTool(tool);
  return { plugins, mcpServers };
}

// Render the /doctor and `bitcode doctor` diagnostic report as lines.
function doctorLines(config, { toolCount, plugins = [], mcpServers = [] } = {}) {
  const lines = [];
  lines.push(t.label("bitcode doctor"));
  lines.push(`  version   ${t.body(VERSION)}`);
  lines.push(`  node      ${t.body(process.version)}`);
  lines.push(`  network   ${t.body(resolveNetwork(config).name)}`);
  lines.push(`  config    ${t.faint(configPath())}`);
  lines.push(t.label("Providers"));
  for (const { line } of providerRows(config)) lines.push("  " + line);
  lines.push(t.label("Tools"));
  lines.push("  " + t.body(`${toolCount ?? "?"} available`));
  lines.push(t.label("Plugins"));
  if (!plugins.length) lines.push("  " + t.faint("none"));
  else for (const p of plugins) lines.push("  " + (p.ok ? t.ok(p.name) : t.danger(`${p.name} — ${p.error}`)));
  lines.push(t.label("Dependencies"));
  for (const dep of dependencyReport(config)) lines.push(`  ${dep.path ? t.ok(dep.name) : t.faint(`${dep.name} unavailable`)} — ${dep.path || dep.purpose}`);
  lines.push(t.label("MCP servers"));
  if (!mcpServers.length) lines.push("  " + t.faint("none"));
  else for (const s of mcpServers) lines.push("  " + (s.ok ? t.ok(`${s.name} (${s.tools} tools)`) : t.danger(`${s.name} — ${s.error}`)));
  return lines;
}

// config.agent.fallback = ["ollama/gpt-oss:20b", …] → resolved targets tried
// in order when the active model's call fails. Unknown specs are skipped.
function resolveFallbacks(config) {
  const specs = config.agent?.fallback;
  if (!Array.isArray(specs)) return [];
  const out = [];
  for (const s of specs) {
    try {
      out.push(resolveModel({ cliModel: s, config }));
    } catch {
      // skip an unresolvable fallback rather than failing startup
    }
  }
  return out;
}

function printModels(config) {
  out(t.label("Providers"));
  for (const { line } of providerLines(config)) out(`  ${line}`);
  out("");
  out(t.faint("use:  bitcode -m <provider>/<model>   e.g.  bitcode -m ollama/gpt-oss:20b"));
}

// ---- output hooks: stream tokens + render the reasoning timeline ----

function clip(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function previewArgs(tc) {
  const a = tc.args || {};
  if (tc.name === "bash") return clip(a.command || "", 100);
  if (a.path) return clip(a.path, 100);
  return clip(JSON.stringify(a), 80);
}

// Fresh per user turn so the "Reasoning" header prints once per turn.
function buildHooks({ approve, askUser, onCheckpoint } = {}) {
  let reasoningOpen = false;
  return {
    onDelta: (piece) => process.stdout.write(piece),
    onAssistantEnd: (text) => {
      if (text) out("");
      emit("modelResponse", { text });
    },
    onToolStart: (tc) => {
      if (!reasoningOpen) {
        out(t.label("Reasoning"));
        reasoningOpen = true;
      }
      const st = t.stageForTool(tc.name);
      out("  " + t.pill(st.hex, st.name) + "  " + t.faint(previewArgs(tc)));
      emit("toolStart", { tc });
    },
    onToolEnd: (tc, result) => {
      const isErr = result.startsWith("ERROR");
      const mark = isErr ? t.danger("✗") : t.ok("✓");
      const lines = result.split("\n");
      out("    " + mark + " " + t.body(clip(lines[0] ?? "", 100)));
      for (const l of lines.slice(1, 5)) out("      " + t.faint(clip(l, 100)));
      if (lines.length > 5) out("      " + t.faint("…"));
      emit("toolEnd", { tc, result });
    },
    approve, askUser, onCheckpoint,
    onFallback: (from, to, err) => out(t.faint(`provider fallback: ${from.spec || from.model} → ${to.spec || to.model} (${err.message})`)),
  };
}

// ---- one-shot ----

const FINANCIAL_TOOLS = new Set(["wallet_send", "btc_broadcast", "bitcoin_rpc", "ln_invoice_pay", "taproot_asset_send", "cashu_melt", "cashu_send", "cashu_pay_request", "cj_wallet_drain"]);
export function requiresPaymentApproval(tool) { return tool.financial === true || FINANCIAL_TOOLS.has(tool.name); }
function printData(value, opts = {}) { out(JSON.stringify(value, null, opts.json ? 0 : 2)); }
async function withInterrupt(work) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("cancelled by user"));
  process.on("SIGINT", abort);
  try { return await work(controller.signal); }
  finally { process.removeListener("SIGINT", abort); }
}
export function runWithInterrupt(options) {
  return withInterrupt(signal => runAgent({ ...options, signal }));
}

async function oneShot({ target, system, tools, network, prompt, limits, fallbacks, opts }) {
  if (!opts.json) { out(t.wordmark(target.spec, network)); out(""); }
  const cwd = process.cwd();
  let session = { id: newSessionId(), messages: [] };
  if (opts.resume) {
    const found = opts.resume === "latest" ? latestSession(cwd) : { id: opts.resume };
    if (!found) throw new Error("no saved session to resume");
    session = loadSession(cwd, found.id);
    if (session.network && session.network !== network) throw new Error("saved session uses a different Bitcoin network");
  }
  const commands = loadCommands();
  if (prompt.startsWith("/")) { const [name, ...args] = prompt.slice(1).split(/\s+/); const command = commands.find(c => c.name === name); if (command) prompt = expandCommand(command, args.join(" ")); }
  const messages = session.messages;
  messages.push({ role: "user", content: expandMentions(prompt) });
  const events = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const persist = () => saveSession(cwd, { ...session, messages, model: target.spec, network });
  const hooks = opts.json ? { onToolEnd: (tc, result) => events.push({ name: tc.name, result }) } : buildHooks();
  hooks.approve = (_tc, tool) => !requiresPaymentApproval(tool) || opts.allowPayments === true;
  hooks.onCheckpoint = persist;
  hooks.onUsage = u => { usage.input_tokens += u.input_tokens || 0; usage.output_tokens += u.output_tokens || 0; };
  try {
    const answer = await runWithInterrupt({ target, system, messages, tools, hooks, limits, fallbacks, readOnly: opts.readOnly });
    const stopped = answer?.startsWith("[stopped:");
    if (stopped) process.exitCode = 2;
    if (opts.json) printData({ answer, status: stopped ? "incomplete" : "completed", session_id: session.id, model: target.spec, usage, events }, opts);
  } catch (err) {
    process.exitCode = 1;
    if (opts.json) printData({ status: "error", error: err.message, session_id: session.id, usage, events }, opts);
    else throw err;
  } finally { persist(); }
}

// ---- interactive REPL ----

async function interactive({ target, system, tools, network, config, yolo, agents, commands, modelRef, resume, limits, fallbacks, ext = {}, readOnly = false, plan, maxStepsOverride }) {
  const cwd = process.cwd();
  const messages = [];
  let active = target;
  const session = { id: newSessionId(), name: null };

  if (resume) {
    try {
      const found = resume === "latest" ? latestSession(cwd) : { id: resume };
      if (!found) {
        out(t.faint("no previous session to resume in this directory"));
      } else {
        const s = loadSession(cwd, found.id);
        if (s.network && s.network !== network) throw new Error("saved session uses a different Bitcoin network");
        messages.push(...s.messages);
        session.id = s.id;
        session.name = s.name;
        out(t.faint(`resumed ${s.id} · ${s.messages.length} messages`));
      }
    } catch (err) {
      out(t.danger(`could not resume: ${err.message}`));
    }
  }

  out("");
  out(t.wordmark(active.spec, network));
  out("  " + t.faint(cwd));
  out("  " + t.stageLegend());
  out("");
  out(t.faint("type a request, or /help for commands. Ctrl+D to quit."));
  out("");

  const menu = buildMenu(commands);
  const history = loadHistory();

  const approve = async (tc, tool) => {
    if (yolo && !requiresPaymentApproval(tool)) return true;
    out(t.faint(JSON.stringify(tc.args || {}, null, 2)));
    const ans = await question("  " + t.accent("approve") + " " + t.bold(tool.name) + ` on ${network} (y/N) `);
    return /^y(es)?$/i.test(ans.trim());
  };

  const persist = () => {
    try {
      saveSession(cwd, { id: session.id, model: active.spec, network, messages, name: session.name });
    } catch (err) {
      out(t.danger(`session save failed: ${err.message}`));
    }
  };

  while (true) {
    const line = await readLine({ prompt: t.accent("› "), menu, history });
    if (line == null) break; // Ctrl+D, or Ctrl+C on an empty line
    let input = line.trim();
    if (!input) continue;
    history.push(input);
    appendHistory(input);

    if (input.startsWith("/")) {
      const [cmd, ...rest] = input.slice(1).split(/\s+/);
      const custom = commands.find((c) => c.name === cmd);
      if (custom) {
        input = expandCommand(custom, rest.join(" "));
      } else {
        const stop = await handleSlash(input, {
          messages,
          config,
          agents,
          commands,
          ask: question,
          system,
          tools,
          cwd,
          network,
          session,
          ext, limits: { ...agentLimits(config), ...(maxStepsOverride ? { maxSteps: maxStepsOverride } : {}) }, fallbacks: resolveFallbacks(config), approve, readOnly, plan, persist,
          getActive: () => active,
          setActive: (x) => {
            active = x;
            modelRef.current = x;
          },
        });
        if (stop === "exit") break;
        continue;
      }
    }

    messages.push({ role: "user", content: expandMentions(input) });
    try {
      await runWithInterrupt({ target: active, system, messages, tools, hooks: buildHooks({ approve, askUser: question, onCheckpoint: persist }), limits: { ...agentLimits(config), ...(maxStepsOverride ? { maxSteps: maxStepsOverride } : {}) }, fallbacks: resolveFallbacks(config), readOnly });
    } catch (err) {
      out(t.danger(`error: ${err.message}`));
    }
    persist(); // auto-save after every completed turn
  }

  persist();
  out(t.faint(`${t.BOLT ? `\n${t.accent(t.BOLT)} ` : "\n"}bye`));
}

export async function handleSlash(input, ctx) {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd) {
    case "exit":
    case "quit":
      return "exit";
    case "reset":
      ctx.messages.length = 0;
      ctx.session.id = newSessionId();
      ctx.session.name = null;
      if (ctx.plan) ctx.plan.steps = [];
      out(t.faint("history cleared"));
      return;
    case "tools":
      for (const tool of ctx.tools.filter(x => !arg || x.name.includes(arg))) out(`${tool.name}${isMutating(tool) ? " [approval]" : ""} — ${tool.description || ""}`);
      return;
    case "model":
      if (!arg) {
        out(t.faint(`active model: `) + t.body(ctx.getActive().spec));
        return;
      }
      try {
        const next = resolveModel({ cliModel: arg, config: ctx.config });
        ctx.setActive(next);
        out(t.ok(`switched to ${next.spec}`));
      } catch (err) {
        out(t.danger(err.message));
      }
      return;
    case "models": {
      const entries = providerLines(ctx.config);
      entries.forEach(({ line }, i) => out(`  ${t.faint(String(i + 1).padStart(2))}  ${line}`));
      out("");
      const ans = (await ctx.ask(t.faint("select # or type provider/model: "))).trim();
      if (!ans) return;
      const spec = /^\d+$/.test(ans) ? entries[Number(ans) - 1]?.spec : ans;
      if (!spec) {
        out(t.danger(`no such entry: ${ans}`));
        return;
      }
      try {
        const next = resolveModel({ cliModel: spec, config: ctx.config });
        ctx.setActive(next);
        out(t.ok(`switched to ${next.spec}`));
      } catch (err) {
        out(t.danger(err.message));
      }
      return;
    }
    case "subagent": {
      if (!arg) {
        if (!ctx.agents.length) {
          out(t.faint(`no agents found in ${agentsDir()}`));
          return;
        }
        for (const a of ctx.agents) out(`  ${t.accent(a.name)}  ${t.faint(a.description || "")}`);
        return;
      }
      const [name, ...promptParts] = rest;
      const persona = findAgent(ctx.agents, name);
      const prompt = persona ? promptParts.join(" ") : arg;
      if (name && !persona) {
        out(t.faint(`no agent "${name}" — running with the base system prompt`));
      }
      if (!prompt) {
        out(t.danger("usage: /subagent [name] <prompt>"));
        return;
      }
      const nestedSystem = persona ? `${ctx.system}\n\n${persona.body}` : ctx.system;
      const nestedMessages = [{ role: "user", content: expandMentions(prompt) }];
      out(t.faint(`— delegating to ${persona ? persona.name : "(default)"} —`));
      try {
        await runWithInterrupt({ target: ctx.getActive(), system: nestedSystem, messages: nestedMessages, tools: ctx.tools.filter(t => t.name !== "subagent"), hooks: buildHooks({ approve: ctx.approve, askUser: ctx.ask }), limits: ctx.limits || agentLimits(ctx.config), fallbacks: ctx.fallbacks || resolveFallbacks(ctx.config), readOnly: ctx.readOnly });
      } catch (err) {
        out(t.danger(`error: ${err.message}`));
      }
      out(t.faint("— done —"));
      return;
    }
    case "skills": return printData(loadSkills());
    case "commands": return printData((ctx.commands || loadCommands()).map(({ name, description }) => ({ name, description })));
    case "mcp": return printData(ctx.ext?.mcpServers || []);
    case "status": return printData({ model: ctx.getActive().spec, readOnly: !!ctx.readOnly, ...contextStats(ctx.messages), usage: ctx.messages.reduce((u, m) => ({ input_tokens: u.input_tokens + (m.usage?.input_tokens || 0), output_tokens: u.output_tokens + (m.usage?.output_tokens || 0) }), { input_tokens: 0, output_tokens: 0 }), plan: ctx.plan });
    case "compact": {
      try {
        ctx.persist?.();
        // Preserve a complete checkpoint before replacing older messages.
        saveSession(ctx.cwd, { id: newSessionId(), model: ctx.getActive().spec, network: ctx.network, messages: ctx.messages, name: "before compaction" });
        const changed = await withInterrupt(signal => compactContext({ messages: ctx.messages, target: ctx.getActive(), signal }));
        ctx.persist?.();
        out(changed ? t.ok("context compacted") : t.faint("not enough older turns to compact"));
      } catch (err) { out(t.danger(err.message)); }
      return;
    }
    case "plan": {
      if (!arg) return out(t.faint("usage: /plan <task>"));
      try {
        const text = await runWithInterrupt({ target: ctx.getActive(), system: `${ctx.system}\nInvestigate the task using read-only tools. Return a concrete implementation plan with files, steps and verification. Do not implement changes.`, messages: [{ role: "user", content: expandMentions(arg) }], tools: ctx.tools, limits: ctx.limits || agentLimits(ctx.config), fallbacks: ctx.fallbacks || resolveFallbacks(ctx.config), readOnly: true, hooks: buildHooks({ askUser: ctx.ask }) });
        if (!text?.startsWith("[stopped:")) out(t.ok(`plan saved: ${savePlan(ctx.cwd, { task: arg, text })}`));
      } catch (err) { out(t.danger(err.message)); }
      return;
    }
    case "build": {
      const plan = latestPlan(ctx.cwd);
      if (!plan) return out(t.faint("no saved plan; use /plan <task>"));
      if (ctx.readOnly) return out(t.danger("restart without --read-only to implement the plan"));
      ctx.messages.push({ role: "user", content: `Implement this saved plan, inspect current files first, and verify the changes:\n${plan.text}` });
      try { await runWithInterrupt({ target: ctx.getActive(), system: ctx.system, messages: ctx.messages, tools: ctx.tools, limits: ctx.limits || agentLimits(ctx.config), fallbacks: ctx.fallbacks || resolveFallbacks(ctx.config), hooks: buildHooks({ approve: ctx.approve, askUser: ctx.ask, onCheckpoint: ctx.persist }) }); }
      catch (err) { out(t.danger(err.message)); }
      ctx.persist?.();
      return;
    }
    case "doctor": {
      const ext = ctx.ext || {};
      for (const line of doctorLines(ctx.config, {
        toolCount: ctx.tools.length,
        plugins: ext.plugins,
        mcpServers: ext.mcpServers,
      })) {
        out(line);
      }
      return;
    }
    case "setting":
    case "settings": {
      out(t.label("Providers"));
      for (const { line } of providerRows(ctx.config)) out("  " + line);
      out("");
      out("  " + t.faint("active model: ") + t.body(ctx.getActive().spec));
      out("  " + t.faint("config:       ") + configPath());
      return;
    }
    case "config": {
      const [sub, key, ...valp] = rest;
      if (sub === "get") {
        if (!key) {
          out(configPath());
          return;
        }
        const v = configGet(ctx.config, key);
        out(v === undefined ? t.faint("(unset)") : t.body(JSON.stringify(redact(v, key))));
        return;
      }
      if (sub === "set") {
        if (!key || !valp.length) {
          out(t.danger("usage: /config set <key> <value>"));
          return;
        }
        const raw = valp.join(" ");
        let value = raw;
        try { value = JSON.parse(raw); } catch { /* plain string */ }
        try {
          configSet(ctx.config, key, value);
          const file = saveConfig(ctx.config);
          out(t.ok(`set ${key} → ${/key|token|secret|macaroon|password/i.test(key) ? "[redacted]" : raw}`) + t.faint(`  (${file})`));
          if (key !== "model") out(t.faint("Agent limits take effect next turn; restart to reload tool, network, MCP and provider settings."));
          if (key === "model") {
            try {
              ctx.setActive(resolveModel({ config: ctx.config }));
              out(t.faint(`active model: ${ctx.getActive().spec}`));
            } catch (err) {
              out(t.danger(err.message));
            }
          }
        } catch (err) {
          out(t.danger(`save failed: ${err.message}`));
        }
        return;
      }
      out(t.faint("usage: /config get [key] | /config set <key> <value>"));
      out(t.faint(`file: ${configPath()}`));
      return;
    }
    case "login": {
      if (rest.length > 1) { out(t.danger("usage: /login [provider]; enter the API key only at the prompt")); return; }
      try {
        const result = await providerLogin(ctx.config, rest[0], { ask: ctx.ask, print: out });
        out(result.ok ? t.ok(result.msg) : t.danger(result.msg));
        if (result.ok) ctx.setActive(resolveModel({ cliModel: ctx.getActive().spec, config: ctx.config }));
      } catch (err) { out(t.danger(`login failed: ${err.message}`)); }
      return;
    }
    case "provider": {
      const [sub, name] = rest;
      if (sub === "add") {
        if (!name) {
          out(t.danger("usage: /provider add <name>"));
          return;
        }
        const r = await providerAdd(ctx.config, name);
        out(r.ok ? t.ok(r.msg) : t.danger(r.msg));
        if (r.ok) {
          // re-resolve the active model so a key for the active provider takes effect now
          try {
            ctx.setActive(resolveModel({ cliModel: ctx.getActive().spec, config: ctx.config }));
          } catch {
            // ignore — status is already reflected in config
          }
        }
        return;
      }
      if (sub === "health") {
        const providers = allProviders(ctx.config);
        for (const [name, p] of Object.entries(providers)) {
          const apiKey = (p.keyEnv ? process.env[p.keyEnv] : undefined) || p.apiKey;
          const { ok, detail } = await providerHealth(p, apiKey);
          out(`  ${t.accent(name.padEnd(12))} ${ok ? t.ok("● " + detail) : t.danger("● " + detail)}`);
        }
        return;
      }
      if (!sub || sub === "list") {
        for (const { line } of providerRows(ctx.config)) out("  " + line);
        return;
      }
      out(t.danger("usage: /provider add <name> | list | health"));
      return;
    }
    case "session": {
      const [sub, ...more] = rest;
      const cwd = ctx.cwd;
      if (!sub || sub === "list") {
        const list = listSessions(cwd);
        if (!list.length) {
          out(t.faint("no saved sessions for this directory"));
          return;
        }
        for (const s of list) {
          const mark = s.id === ctx.session.id ? t.accent("•") : " ";
          out(
            `  ${mark} ${t.body(s.id)}  ${t.faint(`${s.messageCount} msg`)}` +
              (s.name ? "  " + t.accent(s.name) : "") +
              (s.model ? "  " + t.faint(s.model) : ""),
          );
        }
        return;
      }
      if (sub === "save") {
        if (more.length) ctx.session.name = more.join(" ");
        try {
          saveSession(cwd, {
            id: ctx.session.id,
            model: ctx.getActive().spec,
            network: ctx.network,
            messages: ctx.messages,
            name: ctx.session.name,
          });
          out(t.ok(`saved ${ctx.session.id}${ctx.session.name ? ` (${ctx.session.name})` : ""}`));
        } catch (err) {
          out(t.danger(`save failed: ${err.message}`));
        }
        return;
      }
      if (sub === "load") {
        const id = more[0];
        if (!id) {
          out(t.danger("usage: /session load <id>"));
          return;
        }
        try {
          const s = loadSession(cwd, id);
          if (s.network && s.network !== ctx.network) throw new Error("saved session uses a different Bitcoin network");
          ctx.messages.length = 0;
          ctx.messages.push(...s.messages);
          ctx.session.id = s.id;
          ctx.session.name = s.name;
          out(t.ok(`loaded ${s.id} · ${s.messages.length} messages`));
        } catch (err) {
          out(t.danger(`load failed: ${err.message}`));
        }
        return;
      }
      if (sub === "export") {
        const format = (more[0] || "md").toLowerCase();
        if (format !== "md" && format !== "json") {
          out(t.danger("usage: /session export [md|json]"));
          return;
        }
        try {
          // flush current in-memory state to disk, then serialize it
          saveSession(cwd, {
            id: ctx.session.id,
            model: ctx.getActive().spec,
            network: ctx.network,
            messages: ctx.messages,
            name: ctx.session.name,
          });
          const content = exportSession(cwd, ctx.session.id, format);
          const file = path.join(cwd, `bitcode-session-${ctx.session.id}.${format}`);
          writeFileSync(file, content);
          out(t.ok(`exported → ${file}`));
        } catch (err) {
          out(t.danger(`export failed: ${err.message}`));
        }
        return;
      }
      out(t.danger("usage: /session list | save [name] | load <id> | export [md|json]"));
      return;
    }
    case "help":
      out(t.faint("/model [spec]  /models  /login [provider]  /setting  /config <sub>  /provider <sub>  /doctor  /session <sub>"));
      out(t.faint("/plan <task>  /build  /compact  /status  /skills  /mcp  /commands"));
      out(t.faint("/subagent [name] [prompt]  /tools [filter]  /reset  /exit"));
      if (ctx.commands?.length) out(t.faint(`custom: ${ctx.commands.map((c) => "/" + c.name).join("  ")}`));
      return;
    default:
      out(t.danger(`unknown command: /${cmd}`));
  }
}

function redact(value, key = "") {
  if (/key|token|secret|password|macaroon|mnemonic/i.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map(v => redact(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  return value;
}
