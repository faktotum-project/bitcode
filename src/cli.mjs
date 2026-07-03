// Command-line interface: argument parsing, interactive REPL, and one-shot mode.
// Visual styling comes from the bitcode design system via ./theme.mjs.

import readline from "node:readline";
import { loadConfig, resolveModel, allProviders, configPath } from "./config.mjs";
import { runAgent, systemPrompt } from "./agent.mjs";
import { buildTools } from "./tools.mjs";
import { resolveNetwork } from "./bitcoin/network.mjs";
import { wallet } from "./bitcoin/wallet.mjs";
import { loadCommands, expandCommand } from "./commands.mjs";
import { loadAgents, findAgent, agentsDir } from "./agents.mjs";
import { expandMentions } from "./mentions.mjs";
import * as t from "./theme.mjs";

function out(s = "") {
  process.stdout.write(s + "\n");
}

const HELP = `${t.accent("⚡")} ${t.bold("bitcode")} — minimal multi-provider terminal coding agent

Usage:
  bitcode [options]                  start interactive session
  bitcode [options] "<prompt>"       one-shot: run a single request and exit
  bitcode -p "<prompt>"              same as above (explicit)
  bitcode models                     list known providers and default models
  bitcode config                     print the config file path
  bitcode wallet seed                reveal the wallet's mnemonic (human only)

Options:
  -m, --model <provider>/<model>     model to use (e.g. ollama/gpt-oss:20b,
                                     anthropic/claude-sonnet-4-6). Defaults to
                                     BITCODE_MODEL, config "model", or a built-in.
  -p, --print <prompt>               one-shot mode (auto-approves tools)
      --yolo                         skip approval prompts for mutating tools
  -h, --help                         show this help
  -v, --version                      show version

Interactive slash commands:
  /help                show commands
  /model [spec]        show or switch the active model
  /models              pick a model interactively from a numbered list
  /subagent [name] [prompt]
                       list personas (~/.bitcode/agents/*.md), or delegate
                       a sub-task to one and print just its final answer
  /tools               list available tools
  /reset               clear conversation history
  /exit, /quit         leave

Custom commands: any ~/.bitcode/commands/<name>.md becomes its own /<name>.

Config: ${configPath()}
`;

function parseArgs(argv) {
  const opts = { yolo: false, print: false, model: null, prompt: null, command: null, walletSub: null };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    if (a === "-v" || a === "--version") return { version: true };
    if (a === "--yolo") opts.yolo = true;
    else if (a === "-m" || a === "--model") opts.model = argv[++i];
    else if (a === "-p" || a === "--print") {
      opts.print = true;
      opts.prompt = argv[++i];
    } else if (a === "models" || a === "config") opts.command = a;
    else if (a === "wallet" && opts.command == null) {
      opts.command = "wallet";
      opts.walletSub = argv[++i] || null;
    } else positionals.push(a);
  }
  if (!opts.prompt && positionals.length) opts.prompt = positionals.join(" ");
  return opts;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) return out(HELP);
  if (opts.version) return out(`${t.accent("⚡")} bitcode 0.1.0`);

  const config = loadConfig();

  if (opts.command === "config") return out(configPath());
  if (opts.command === "models") return printModels(config);
  if (opts.command === "wallet") return walletCommand(opts.walletSub, config);

  let target;
  try {
    target = resolveModel({ cliModel: opts.model, config });
  } catch (err) {
    out(t.danger(`config error: ${err.message}`));
    process.exit(1);
  }

  const ctx = resolveNetwork(config);
  const system = systemPrompt({ network: ctx.name });
  const agents = loadAgents();
  const modelRef = { current: target };
  const tools = buildTools(config, { modelRef, agents, system });

  if (opts.prompt) {
    await oneShot({ target, system, tools, network: ctx.name, prompt: opts.prompt });
    return;
  }
  const commands = loadCommands();
  await interactive({ target, system, tools, network: ctx.name, config, yolo: opts.yolo, agents, commands, modelRef });
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
function buildHooks({ approve } = {}) {
  let reasoningOpen = false;
  return {
    onDelta: (piece) => process.stdout.write(piece),
    onAssistantEnd: (text) => {
      if (text) out("");
    },
    onToolStart: (tc) => {
      if (!reasoningOpen) {
        out(t.label("Reasoning"));
        reasoningOpen = true;
      }
      const st = t.stageForTool(tc.name);
      out("  " + t.pill(st.hex, st.name) + "  " + t.faint(previewArgs(tc)));
    },
    onToolEnd: (_tc, result) => {
      const isErr = result.startsWith("ERROR");
      const mark = isErr ? t.danger("✗") : t.ok("✓");
      const lines = result.split("\n");
      out("    " + mark + " " + t.body(clip(lines[0] ?? "", 100)));
      for (const l of lines.slice(1, 5)) out("      " + t.faint(clip(l, 100)));
      if (lines.length > 5) out("      " + t.faint("…"));
    },
    approve,
  };
}

// ---- one-shot ----

async function oneShot({ target, system, tools, network, prompt }) {
  out(t.wordmark(target.spec, network));
  out("");
  const messages = [{ role: "user", content: expandMentions(prompt) }];
  await runAgent({ target, system, messages, tools, hooks: buildHooks() });
}

// ---- interactive REPL ----

async function interactive({ target, system, tools, network, config, yolo, agents, commands, modelRef }) {
  const messages = [];
  let active = target;

  out("");
  out(t.wordmark(active.spec, network));
  out("  " + t.faint(process.cwd()));
  out("  " + t.stageLegend());
  out("");
  out(t.faint("type a request, or /help for commands. Ctrl+C to quit."));
  out("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: t.accent("› "),
  });

  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  const approve = yolo
    ? undefined
    : async (tc, tool) => {
        const what = tc.name === "bash" ? `$ ${tc.args.command}` : `${tc.name} ${tc.args.path || ""}`;
        const ans = await ask(
          "  " + t.accent("approve") + " " + t.bold(tool.name) + t.faint(` [${clip(what, 80)}]`) + " (y/N) ",
        );
        return /^y(es)?$/i.test(ans.trim());
      };

  rl.prompt();
  for await (const line of rl) {
    let input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

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
          ask,
          system,
          tools,
          getActive: () => active,
          setActive: (x) => {
            active = x;
            modelRef.current = x;
          },
        });
        if (stop === "exit") break;
        rl.prompt();
        continue;
      }
    }

    messages.push({ role: "user", content: expandMentions(input) });
    try {
      await runAgent({ target: active, system, messages, tools, hooks: buildHooks({ approve }) });
    } catch (err) {
      out(t.danger(`error: ${err.message}`));
    }
    rl.prompt();
  }

  rl.close();
  out(t.faint(`\n${t.accent("⚡")} bye`));
}

async function handleSlash(input, ctx) {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd) {
    case "exit":
    case "quit":
      return "exit";
    case "reset":
      ctx.messages.length = 0;
      out(t.faint("history cleared"));
      return;
    case "tools":
      out(t.faint(ctx.tools.map((x) => x.name).join(", ")));
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
        await runAgent({ target: ctx.getActive(), system: nestedSystem, messages: nestedMessages, tools: ctx.tools, hooks: buildHooks() });
      } catch (err) {
        out(t.danger(`error: ${err.message}`));
      }
      out(t.faint("— done —"));
      return;
    }
    case "help":
      out(t.faint("/model [spec]  /models  /subagent [name] [prompt]  /tools  /reset  /exit"));
      if (ctx.commands.length) out(t.faint(`custom: ${ctx.commands.map((c) => "/" + c.name).join("  ")}`));
      return;
    default:
      out(t.danger(`unknown command: /${cmd}`));
  }
}
