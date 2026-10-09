import { bitcodeHome } from "./paths.mjs";
// Command-line interface: argument parsing, interactive REPL, and one-shot mode.
// Visual styling comes from the design system (design/system) via ./theme.mjs.

import readline from "node:readline";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, resolveModel, allProviders, configPath, configGet, configSet, saveConfig } from "./config.mjs";
import { providerRows, providerAdd, providerLogin } from "./settings.mjs";
import { providerHealth } from "./providers.mjs";
import { isLocalProvider, describeLocalModel, localSetupHint } from "./local-models.mjs";
import { localInventory, bestLocalModel, runtimeProvider } from "./local-inventory.mjs";
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
import { runSubagent } from "./subagents.mjs";
import { runSat } from "./sat-runtime.mjs";
import { loadSats, findSat } from "./sats.mjs";
import { satLang } from "./sat-states.mjs";
import { detectCaps } from "./term-caps.mjs";
import { randomUUID } from "node:crypto";
import { headerLine, legacyHeader, satCards, approvalCard, WORDMARK, diffLine, reviewCard, financeBox, welcomeSats } from "./cli-brand.mjs";
import { createLiveLine } from "./cli-live.mjs";
import { satWorkspace, satHistory } from "./sat-workspace.mjs";
import { createEventBus, createRunContext } from "./runtime/events.mjs";
import { startSatsServer } from "./sats/server.mjs";
import { buildTools, registerTool } from "./tools.mjs";
import { PROFILES, discoverProject, projectRoot, resolveProfile } from "./project.mjs";
import { bubblewrapAvailable, mayAutoApprove, resolvePermissions } from "./permissions.mjs";
import { TurnCheckpoint } from "./checkpoint.mjs";
import { resolveNetwork } from "./bitcoin/network.mjs";
import { wallet } from "./bitcoin/wallet.mjs";
import { executeBitcoin, financeStatus, prepareBitcoin, reconcileBitcoin, recoverBitcoinOperation, setFinancePolicy } from "./finance/bitcoin.mjs";
import { assertFinanceModel, financeAgentTools } from "./finance/agent.mjs";
import { recoverFinanceLock } from "./finance/store.mjs";
import { loadCommands, expandCommand } from "./commands.mjs";
import { loadAgents, findAgent, agentsDir } from "./agents.mjs";
import { expandMentions } from "./mentions.mjs";
import { readLine, question, closeInput } from "./tui.mjs";
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
  { name: "profile", hint: "show or switch code/bitcoin/rgb profile", args: true },
  { name: "diff", hint: "show changes from the latest agent turn" },
  { name: "undo", hint: "restore the latest agent turn when safe" },
  { name: "skills", hint: "list local skills" },
  { name: "mcp", hint: "show MCP connections" },
  { name: "commands", hint: "list bundled and custom commands" },
  { name: "model", hint: "show or switch the active model", args: true },
  { name: "models", hint: "pick a provider or an installed local model" },
  { name: "setting", hint: "provider status & active model" },
  { name: "config", hint: "get · set config values", args: true },
  { name: "provider", hint: "add an API key · list providers", args: true },
  { name: "login", hint: "configure a provider with a masked API key", args: true },
  { name: "doctor", hint: "config, provider, tools & plugin diagnostics" },
  { name: "session", hint: "save · load · list · export", args: true },
  { name: "sats", hint: "list persistent Sats" },
  { name: "sat", hint: "select · info · workspace", args: true },
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
  bitcode models                     list providers and the models installed locally
  bitcode login [provider]            choose a provider and save a masked API key
  bitcode tools|commands|skills       inspect available capabilities (supports --json)
  bitcode provider list|health        inspect provider configuration/connectivity
  bitcode session list                list saved sessions
  bitcode mcp                         inspect MCP connections
  bitcode config                     print the config file path
  bitcode doctor                     print a diagnostics report
  bitcode wallet seed                reveal the wallet's mnemonic (human only)
  bitcode finance status             show protected signet/testnet proposals
  bitcode finance policy <payment> <daily> <fee> <reserve>  set limits in sats
  bitcode finance prepare <address> <sats> [sat/vB]         prepare a proposal
  bitcode finance execute <id>      review and approve one exact proposal
  bitcode finance reconcile <id>    check transaction status
  bitcode finance recover <id>      mark an interrupted execution for review
  bitcode finance unlock            clear a lock left by a dead process
  bitcode --finance -m <local/model> -p "..."  local proposal assistant

Options:
  -m, --model <provider>/<model>     model to use (e.g. ollama/gpt-oss:20b,
                                     anthropic/claude-sonnet-4-6). Defaults to
                                     BITCODE_MODEL, config "model", or a built-in.
  -p, --print <prompt>               one-shot mode (auto-approves tools)
      --resume [id]                  resume a saved session (latest if no id)
      --continue                     resume the most recent session
      --cwd <path>                   run in this working directory
      --profile <code|bitcoin|rgb>   choose coding, Bitcoin or RGB wallet profile
      --permission <mode>            suggest | auto-edit | full-auto
      --read-only                    expose only read-only tools
      --json                         one-shot JSON result (answer, usage, events)
      --max-steps <n>                bound the number of model rounds
      --allow-payments               explicitly authorize financial tools in one-shot mode
      --finance                      local, restricted proposal-only assistant
      --sats                         local Sats observer (interactive only)
      --no-session                   disable automatic transcript saving
      --yolo                         alias for --permission full-auto (payments still ask)
  -h, --help                         show this help
  -v, --version                      show version

Interactive slash commands:
  /help                show commands
  /plan <task>         investigate with read-only tools and save a plan
  /build               execute the latest saved plan
  /compact             summarize older context
  /status              context and token usage
  /profile [code|bitcoin|rgb]  show or switch tool profile
  /diff /undo           inspect or safely restore the latest agent turn
  /skills /mcp /commands  inspect extensions and commands
  /model [spec]        show or switch the active model
  /models              pick a provider or locally installed model (saved as default)
  /setting             provider key status + active model + config path
  /config <sub>        get [key] · set <key> <value>  (persisted, chmod 600)
  /provider <sub>      add <name> (masked key entry) · list · health
  /login [provider]    choose a provider and save a masked API key
  /session <sub>       save [name] · load <id> · list · export [md|json]
  /sats                list persistent Sats
  /sat <name>          select Node, Script, Hash or Merkle (/reset exits)
  /sat info <name>     inspect identity, permissions and project history
  /sat workspace <name>  show the persistent Sat Workspace
  /tools               list available tools
  /reset               clear conversation history
  /exit, /quit         leave

Custom commands: any ~/.bitcode/commands/<name>.md becomes its own /<name>.

Config: ${configPath()}
`;

export function parseArgs(argv) {
  const opts = { yolo: false, print: false, sats: false, model: null, prompt: null, command: null, resume: null };
  const positionals = [];
  const value = (i, flag) => { const v = argv[i]; if (!v || v.startsWith("--")) throw new Error(`${flag} requires a value`); return v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { positionals.push(...argv.slice(i + 1)); break; }
    if (a === "-h" || a === "--help") return { help: true };
    if (a === "-v" || a === "--version") return { version: true };
    if (a === "--yolo") { opts.yolo = true; opts.permission = "full-auto"; }
    else if (a === "--json") opts.json = true;
    else if (a === "--read-only") opts.readOnly = true;
    else if (a === "--allow-payments") opts.allowPayments = true;
    else if (a === "--finance") opts.finance = true;
    else if (a === "--sats") opts.sats = true;
    else if (a === "--no-session") opts.noSession = true;
    else if (a === "--cwd") opts.cwd = value(++i, a);
    else if (a === "--profile") opts.profile = value(++i, a);
    else if (a === "--permission") opts.permission = value(++i, a);
    else if (a === "--max-steps") { opts.maxSteps = Number(value(++i, a)); if (!Number.isSafeInteger(opts.maxSteps) || opts.maxSteps < 1) throw new Error("--max-steps must be a positive integer"); }
    else if (a === "--continue") opts.resume = "latest";
    else if (a === "--resume") opts.resume = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : "latest";
    else if (a === "-m" || a === "--model") opts.model = value(++i, a);
    else if (a === "-p" || a === "--print") { opts.print = true; opts.prompt = value(++i, a); }
    else if (a.startsWith("-")) throw new Error(`unknown option: ${a}`);
    else if (!opts.command && !opts.prompt && !positionals.length && ["models", "config", "doctor", "wallet", "finance", "tools", "commands", "skills", "mcp", "provider", "login", "session"].includes(a)) {
      opts.command = a;
      if (a === "wallet") opts.walletSub = argv[++i];
    } else positionals.push(a);
  }
  if (opts.command) opts.commandArgs = positionals;
  else if (!opts.prompt && positionals.length) opts.prompt = positionals.join(" ");
  if (opts.command === "login" && (positionals.length > 1 || opts.json || opts.prompt)) throw new Error("usage: bitcode login [provider]; enter the API key only at the prompt");
  if (opts.json && !opts.prompt && !opts.command) throw new Error("--json requires a one-shot prompt or command");
  if (opts.sats && (opts.prompt || opts.print || opts.command || opts.finance || opts.json)) throw new Error("--sats requires interactive mode; omit one-shot prompts and commands");
  if (opts.noSession && opts.resume) throw new Error("--no-session cannot be combined with --resume or --continue");
  return opts;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.cwd) process.chdir(opts.cwd);
  if (opts.help) return out(HELP);
  if (opts.version) return out(`${t.accent(t.BOLT)}${t.BOLT ? " " : ""}bitcode ${VERSION}`);

  const config = loadConfig();
  const root = projectRoot(process.cwd());
  const project = discoverProject(root);
  const profile = resolveProfile({ cliProfile: opts.profile, config, cwd: root });
  let permissions = resolvePermissions({ config, cliPermission: opts.permission, readOnly: opts.readOnly });
  if (permissions.mode === "full-auto" && !bubblewrapAvailable()) {
    permissions = { ...permissions, mode: "auto-edit", sandbox: false };
    process.stderr.write("bitcode: Bubblewrap is unavailable; full-auto downgraded to auto-edit.\n");
  }

  if (opts.command === "login") {
    const result = await providerLogin(config, opts.commandArgs[0], { print: out });
    out(result.ok ? t.ok(result.msg) : t.danger(result.msg));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (opts.command === "config") return out(configPath());
  if (opts.command === "models") {
    if (!opts.json) return printModels(config);
    const inv = await localInventory(config);
    return printData({ providers: redact(allProviders(config)), machine: inv.machine,
      local: inv.servers.map(({ name, label, baseURL, configured, running, models }) => ({ name, label, baseURL, configured, running, models })), idle: inv.idle }, opts);
  }
  if (opts.command === "wallet") return walletCommand(opts.walletSub, config);
  if (opts.command === "finance") return financeCommand(opts.commandArgs || [], config, opts);
  if (opts.command === "commands") return printData(loadCommands().map(({ name, description }) => ({ name, description })), opts);
  if (opts.command === "skills") return printData(loadSkills(), opts);
  if (opts.command === "session" && ![undefined, "list"].includes(opts.commandArgs?.[0])) throw new Error("use /session in interactive mode for save/load/export, or --resume for one-shot continuation");
  if (opts.command === "session" && opts.json) return printData(listSessions(process.cwd()), opts);
  if (opts.command === "provider" && opts.json && [undefined, "list"].includes(opts.commandArgs?.[0])) return printData(redact(allProviders(config)), opts);
  if (opts.command === "provider" || opts.command === "session") return handleSlash(`/${opts.command} ${(opts.commandArgs || []).join(" ")}`, { config, cwd: process.cwd(), session: {}, messages: [], network: resolveNetwork(config).name, getActive: () => resolveModel({ config }), setActive: () => {}, ask: question });
  if (["doctor", "tools", "mcp"].includes(opts.command)) {
    const ext = await loadExtensions(config, profile);
    try {
      const tools = buildTools(config, { profile, workspaceRoot: root, sandbox: permissions.sandbox });
      if (opts.command === "tools") return printData(tools.map(({ name, description, parameters, mutating }) => ({ name, description, parameters, mutating })), opts);
      if (opts.command === "mcp") return printData(ext.mcpServers, opts);
      const lines = doctorLines(config, { toolCount: tools.length, ...ext });
      return opts.json ? printData({ version: VERSION, node: process.version, tools: tools.length, dependencies: dependencyReport(config), ...ext }, opts) : lines.forEach(out);
    } finally { await closeMcpConnections(); await closeWavelength(); }
  }

  let target;
  try {
    target = resolveModel({ cliModel: await startupModel(opts, config), config });
  } catch (err) {
    out(t.danger(`config error: ${err.message}`));
    process.exit(1);
  }

  if (opts.finance) {
    if (!opts.prompt || opts.resume || opts.allowPayments || opts.command) throw new Error("--finance requires a fresh one-shot prompt and does not accept --resume or --allow-payments");
    assertFinanceModel(target);
    const ctx = resolveNetwork(config);
    const messages = [{ role: "user", content: opts.prompt }];
    const system = `You are Bitcode's local financial proposal assistant on Bitcoin ${ctx.name}. You can inspect policy and prepare unsigned proposals only. Never claim a payment has been sent. For execution, tell the human to review and run bitcode finance execute <proposal-id> in an interactive terminal. Do not ask for seeds, keys, macaroons or credentials.`;
    const tools = financeAgentTools(config, root);
    const answer = await runWithInterrupt({ target, system, messages, tools, fallbacks: [], hooks: { approve: () => true }, limits: agentLimits(config), readOnly: opts.readOnly });
    if (opts.json) return printData({ status: "completed", answer, payment_status: "not_sent", model: target.spec, profile: "finance", events: messages.filter(m => m.role === "tool").map(m => ({ name: m.name, result: m.content })) }, opts);
    out(answer);
    return out("No payment was signed or sent. Review and execute a proposal separately.");
  }

  const ctx = resolveNetwork(config);
  const skills = loadSkills();
  const system = systemPrompt({ profile, network: ctx.name, lightning: !!config.lightning?.lndRestUrl, project }) + (profile === "rgb" ? "" : "\n\n" + contextPrompt(root, skills));
  const agents = loadAgents();
  const modelRef = { current: target };
  const ext = await loadExtensions(config, profile); // plugins + MCP register their tools first
  const plan = { steps: [] };
  let tools;
  try { tools = buildTools(config, { modelRef, agents, system, skills, plan, profile, workspaceRoot: root, sandbox: permissions.sandbox }); }
  catch (err) { await closeMcpConnections(); await closeWavelength(); throw err; }

  const limits = agentLimits(config);
  if (opts.maxSteps) limits.maxSteps = opts.maxSteps;
  const fallbacks = resolveFallbacks(config);

  const bus = opts.sats ? createEventBus() : undefined;
  let satsServer;
  try {
    if (opts.prompt) return await oneShot({ target, system, tools, network: ctx.name, prompt: opts.prompt, limits, fallbacks, opts, permissions, root, profile, project });
    if (opts.sats) {
      satsServer = await startSatsServer({ bus, network: ctx.name });
      out(`Sats · apri ${satsServer.url}`);
    }
    const commands = loadCommands();
    await interactive({ target, system, tools, network: ctx.name, config, yolo: opts.yolo, agents, commands, modelRef, resume: opts.resume, limits, fallbacks, ext, readOnly: opts.readOnly, plan, maxStepsOverride: opts.maxSteps, permissions, root, profile, project, bus, noSession: opts.noSession });
  } finally { closeInput(); await satsServer?.close(); await closeProcesses(); await closeCashuDaemons(); await closeMcpConnections(); await closeWavelength(); }
}

// With no model chosen anywhere (flag, BITCODE_MODEL, config) and no key for
// the built-in fallback, start on a model this machine actually has installed
// instead of failing on a missing API key.
async function startupModel(opts, config) {
  if (opts.model || process.env.BITCODE_MODEL || config.model) return opts.model;
  const fallback = resolveModel({ config });
  if (fallback.apiKey || isLocalProvider(fallback.provider)) return undefined;
  const spec = bestLocalModel(await localInventory(config), config);
  if (!spec) return undefined;
  const note = t.faint(`no model configured and no ${fallback.providerName} key — using local ${spec} (change with /models)`);
  if (opts.json || opts.prompt) process.stderr.write(note + "\n");
  else out(note);
  return spec;
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

async function financeCommand(args, config, opts) {
  const [sub, ...values] = args;
  if (sub === "status") {
    const caps = detectCaps();
    return process.stdout.isTTY && !opts.json && caps.level !== "text" ? out(financeBox(financeStatus(), caps, satLang())) : printData(financeStatus(), opts);
  }
  if (sub === "policy") {
    if (!process.stdin.isTTY || opts.json || values.length !== 4) throw new Error("usage (interactive terminal): bitcode finance policy <max-payment-sats> <daily-limit-sats> <max-fee-sats> <min-reserve-sats>");
    const [maxPaymentSats, dailyLimitSats, maxFeeSats, minReserveSats] = values;
    const policy = { maxPaymentSats, dailyLimitSats, maxFeeSats, minReserveSats };
    out(`Financial policy (sats): ${JSON.stringify(policy)}`);
    if ((await question('Type "SET POLICY" to apply: ')).trim() !== "SET POLICY") return out("cancelled");
    return printData(setFinancePolicy(policy), opts);
  }
  if (sub === "prepare") {
    if (values.length < 2 || values.length > 3) throw new Error("usage: bitcode finance prepare <address> <amount-sats> [fee-rate-sat/vB]");
    return printData(await prepareBitcoin(config, { to: values[0], amountSats: values[1], feeRate: values[2] }), opts);
  }
  if (sub === "execute") {
    if (!process.stdin.isTTY || opts.json || values.length !== 1) throw new Error("finance execute requires an interactive terminal and a proposal id");
    const result = await executeBitcoin(config, values[0], { approve: async proposal => {
      const caps = detectCaps();
      if (caps.level !== "text") out("\n" + reviewCard(proposal, caps, satLang()));
      else {
      out(`\nReview Bitcoin ${proposal.network} payment:`);
      out(`  Wallet: ${proposal.wallet}`);
      out(`  Recipient: ${proposal.to}`);
      out(`  Amount: ${proposal.amountSats} sats`);
      out(`  Fee: ${proposal.feeSats} sats (${proposal.feeRate} sat/vB)`);
      out(`  Policy version: ${proposal.policyVersion}`);
      out(`  Expires: ${proposal.expiresAt}`);
      out(`  Proposal ID: ${proposal.id}`);
      }
      out("Signing and broadcasting can move funds. An uncertain result will not be retried automatically.");
      const answer = await question("Type the full proposal ID to approve: ");
      return answer.trim() === proposal.id;
    } });
    return printData(result, opts);
  }
  if (sub === "reconcile") {
    if (values.length !== 1) throw new Error("usage: bitcode finance reconcile <proposal-id>");
    return printData(await reconcileBitcoin(config, values[0]), opts);
  }
  if (sub === "recover") {
    if (!process.stdin.isTTY || opts.json || values.length !== 1) throw new Error("finance recover requires an interactive terminal and a proposal id");
    const proposal = financeStatus().proposals.find(p => p.id === values[0]);
    if (!proposal || proposal.status !== "executing") throw new Error("proposal is not in executing state");
    out(`Interrupted proposal ${proposal.id}\nTxid: ${proposal.txid || "none recorded"}`);
    if ((await question("Type the full proposal ID to recover its state: ")).trim() !== proposal.id) return out("cancelled");
    return printData(recoverBitcoinOperation(proposal.id), opts);
  }
  if (sub === "unlock") {
    if (!process.stdin.isTTY || opts.json || values.length) throw new Error("finance unlock requires an interactive terminal");
    if ((await question('Type "UNLOCK" after inspecting the process: ')).trim() !== "UNLOCK") return out("cancelled");
    return out(recoverFinanceLock() ? "stale lock removed; inspect finance status and reconcile uncertain payments" : "no lock present");
  }
  throw new Error("usage: bitcode finance <status|policy|prepare|execute|reconcile|recover|unlock>");
}

// Remote (API) providers: one selectable entry per provider, using its default
// model. Local providers are listed separately with the models they really have.
function providerLines(config) {
  const providers = allProviders(config);
  return Object.entries(providers).filter(([, p]) => !isLocalProvider(p)).map(([name, p]) => {
    const key = !p.keyEnv
      ? (p.apiKey ? t.ok("saved key ✓") : t.faint("no key"))
      : process.env[p.keyEnv]
        ? `${p.keyEnv} ${t.ok("✓")}`
        : p.apiKey
          ? t.ok("saved key ✓")
          : t.faint(`${p.keyEnv} (unset)`);
    const line =
      `${t.accent(name)}  ${t.faint(`[${p.api}]`)}  ${t.body("default:")} ${p.defaultModel || "-"}  ${key}\n` +
      "  " + t.faint(`  ${p.baseURL}`);
    return { spec: p.defaultModel ? `${name}/${p.defaultModel}` : name, name, line };
  });
}

// Everything this machine can run, whoever downloaded it: servers on
// well-known ports (configured or merely detected) with a memory-fit badge per
// model, plus models on disk that no server is serving yet.
// → { machine, sections: [{ header, hint?, entries: [{ spec, line, addProvider? }] }], idle }
const GIB = 1024 ** 3;
const gib = n => (n ? `${(n / GIB).toFixed(n < 10 * GIB ? 1 : 0)} GB` : "");
const FIT = { gpu: () => t.ok("GPU"), ram: () => t.ok("RAM"), tight: () => t.accent("tight"), "too-big": () => t.danger("too big"), unknown: () => "" };
function machineLine({ ram, gpus, cpus }) {
  const gpu = gpus.map(g => `${g.name}${g.vram ? ` ${gib(g.vram)}` : ""}${g.unified ? " shared" : ""}`).join(", ");
  return t.faint(`RAM ${gib(ram.total)} (${gib(ram.available)} free)${gpu ? ` · GPU ${gpu}` : ""} · ${cpus} cores`);
}
async function localSections(config) {
  const inv = await localInventory(config);
  // Ollama is always shown (with setup help); other servers only when they
  // answer or the user configured them explicitly.
  const sections = inv.servers.filter(s => s.running || s.name === "ollama" || config.providers?.[s.name]).map(s => ({
    header: `${t.accent(s.label || s.name)}  ${t.faint(s.baseURL)}${s.configured ? "" : `  ${t.accent("detected · added on selection")}`}`,
    hint: s.models.length ? null : localSetupHint(s.name, s.running),
    entries: s.models.map(m => ({
      spec: m.spec,
      addProvider: s.configured ? null : s.name,
      line: `${t.body(m.spec)}  ${FIT[m.fit]?.() || ""}  ${t.faint([gib(m.size), describeLocalModel({ ...m, size: 0 })].filter(Boolean).join(" · "))}`,
    })),
  }));
  return { machine: inv.machine, sections, idle: inv.idle };
}
function idleLines(idle) {
  if (!idle.length) return [];
  return [t.label("Downloaded, not served"), ...idle.flatMap(d => [
    `    ${t.body(d.name)}  ${FIT[d.fit]?.() || ""}  ${t.faint(`${d.runtime} · ${gib(d.size)}`)}`,
    ...(d.hint ? [t.faint(`      serve: ${d.hint}`)] : []),
  ])];
}
// Persist a detected runtime as a local provider so its models resolve.
function ensureRuntimeProvider(config, name) {
  if (!name || config.providers?.[name]) return false;
  const entry = runtimeProvider(name);
  if (!entry) return false;
  config.providers = { ...(config.providers || {}), [name]: entry };
  saveConfig(config);
  return true;
}

// Load user extensions: plugins (~/.bitcode/plugins/*.mjs) and MCP servers
// (config.mcp). Both register their tools into the shared registry so a later
// buildTools() picks them up. Returns diagnostics for /doctor.
async function loadExtensions(config, profile = "code") {
  const plugins = await loadPlugins();
  const { tools: mcp, servers: mcpServers } = await mcpTools(config);
  for (const tool of mcp) registerTool(tool);
  if (profile === "bitcoin") {
    const wavelength = await wavelengthTools(config);
    for (const tool of wavelength) registerTool({ ...tool, profile: "bitcoin" });
  }
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

async function printModels(config) {
  out(t.label("Providers"));
  for (const { line } of providerLines(config)) out(`  ${line}`);
  out("");
  const local = await localSections(config);
  out(t.label("Local models (this machine)") + "  " + machineLine(local.machine));
  for (const section of local.sections) {
    out(`  ${section.header}`);
    for (const { line } of section.entries) out(`    ${line}`);
    if (section.hint) out(t.faint(`    ${section.hint}`));
  }
  for (const line of idleLines(local.idle)) out(`  ${line}`);
  out("");
  out(t.faint("use:  bitcode -m <provider>/<model>   or pick interactively with /models"));
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
function buildHooks({ approve, askUser, onCheckpoint, checkpoint, onMutation } = {}) {
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
    onToolEnd: async (tc, result, metadata) => {
      const isErr = result.startsWith("ERROR");
      const mark = metadata?.outcome === "denied" ? t.danger("⊘ Rifiutato") : isErr ? t.danger("✗") : t.ok("✓");
      const lines = result.split("\n");
      out("    " + mark + " " + t.body(clip(lines[0] ?? "", 100)));
      for (const l of lines.slice(1, 5)) out("      " + t.faint(clip(l, 100)));
      if (lines.length > 5) out("      " + t.faint("…"));
      emit("toolEnd", { tc, result });
      if (checkpoint?.active && isMutating({ name: tc.name })) {
        const diff = checkpoint.diff();
        if (diff && diff !== "[no changes]") out(t.faint(clip(diff, 4000)));
      }
    },
    approve, askUser, onCheckpoint, onMutation,
    onFallback: (from, to, err) => out(t.faint(`provider fallback: ${from.spec || from.model} → ${to.spec || to.model} (${err.message})`)),
  };
}

function previewMutation(tc) {
  const caps = detectCaps();
  if (caps.level !== "text") return rawPreview(tc).split("\n").map(l => diffLine(l.replace(/\x1b\[[0-9;]*m/g, ""), caps)).join("\n");
  return rawPreview(tc);
}
function rawPreview(tc) {
  const p = tc.args?.path || "file";
  if (tc.name === "patch") return t.faint(`--- ${p}\n`) + String(tc.args?.diff || "").split("\n").filter(x => /^[+-]/.test(x)).map(x => x.startsWith("+") ? t.ok(x) : t.danger(x)).join("\n");
  if (tc.name === "edit_file") {
    const edits = tc.args?.edits || [{ old_string: tc.args?.old_string, new_string: tc.args?.new_string }];
    return t.faint(`--- ${p}\n+++ ${p}`) + "\n" + edits.map(e => `${t.danger("-" + (e.old_string || ""))}\n${t.ok("+" + (e.new_string || ""))}`).join("\n");
  }
  return `${t.faint(`--- ${p}\n+++ ${p}`)}\n${t.ok("+" + String(tc.args?.content || ""))}`;
}

function printTurnSummary(files = []) {
  if (!files.length) return;
  out(t.label("Turn summary"));
  for (const file of files) out(`  ${file.path}  ${t.ok("+" + file.added)} ${t.danger("-" + file.removed)}`);
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
  return withInterrupt(async signal => {
    if (options.onSatEvent) return options.context?.satId ? runSat({ ...options, signal, satId: options.context.satId, persistence: options.context.satPersistence !== false }) : runAgent({ ...options, signal });
    const satId = options.context?.satId || null, bus = options.context?.bus || createEventBus(), runId = options.context?.runId || randomUUID();
    const provider = options.target?.provider || {};
    const live = createLiveLine({ caps: detectCaps(), registry: loadSats(), lang: satLang(), subject: { satId, runId, providerName: options.target?.providerName, baseURL: provider.baseURL, model: options.target?.model } });
    const hooks = { ...options.hooks, onDelta: p => { live.hooks.onDelta(p); options.hooks?.onDelta?.(p); }, onUsage: u => { live.hooks.onUsage(u); options.hooks?.onUsage?.(u); } };
    const unsubscribe = bus.subscribe(event => { if (event.runId === runId || event.parentRunId === runId) live.onEvent(event); });
    const context = { ...options.context, bus, runId };
    let outcome = "error";
    try {
      const result = await (satId ? runSat({ ...options, hooks, context, signal, satId, persistence: options.context.satPersistence !== false }) : runAgent({ ...options, hooks, context, signal }));
      outcome = signal.aborted ? "cancelled" : "ok";
      return result;
    } catch (error) { outcome = signal.aborted ? "cancelled" : "error"; throw error; } finally { unsubscribe(); live.stop(outcome); }
  });
}

// Banner: one line. On a capable terminal the wordmark types itself in (the "b" in orange), otherwise it is simply printed.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function banner(modelSpec, network, { animate }) {
  const caps = detectCaps();
  if (caps.level === "text") return out(legacyHeader(modelSpec, network));
  if (animate && caps.level === "full" && !process.env.BITCODE_NO_INTRO) {
    const show = process.stdout.write.bind(process.stdout), restore = () => show("\x1b[?25h");
    process.once("exit", restore);
    try {
      show("\x1b[?25l");
      for (let n = 1; n < WORDMARK.length; n++) { show("\r" + headerLine(modelSpec, network, caps, n) + "\x1b[K"); await sleep(70); }
    } finally { restore(); process.removeListener("exit", restore); }
    show("\r");
  }
  out(headerLine(modelSpec, network, caps));
}
async function oneShot({ target, system, tools, network, prompt, limits, fallbacks, opts, permissions, root, profile, project }) {
  if (!opts.json) { await banner(target.spec, network, { animate: false }); out(""); }
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
  const checkpoint = new TurnCheckpoint(root);
  const persist = () => { if (!opts.noSession) saveSession(cwd, { ...session, messages, model: target.spec, network }); };
  const hooks = opts.json ? { onToolEnd: (tc, result) => events.push({ name: tc.name, result }) } : buildHooks({ checkpoint });
  // One-shot mode has no approval UI and has historically been the explicit
  // automation entry point. Financial tools remain an unconditional gate.
  hooks.approve = (tc, tool) => requiresPaymentApproval(tool)
    ? opts.allowPayments === true
    : opts.permission ? mayAutoApprove({ tool, args: tc.args, permissions }) : true;
  // One-shot sessions do not expose /undo; avoid a potentially expensive
  // workspace snapshot before short-lived CI-style commands.
  hooks.onCheckpoint = persist;
  hooks.onUsage = u => { usage.input_tokens += u.input_tokens || 0; usage.output_tokens += u.output_tokens || 0; };
  try {
    const answer = await runWithInterrupt({ target, system, messages, tools, hooks, limits, fallbacks, readOnly: opts.readOnly });
    const summary = checkpoint.finalize();
    // Some platforms deliver Ctrl+C to the shell process before Node's signal
    // handler. Treat that terminal process result as cancellation too.
    if (events.some(event => /(?:cancelled|SIGINT)/i.test(String(event.result)))) throw new Error("cancelled by user");
    const stopped = answer?.startsWith("[stopped:");
    if (stopped && events.some(event => String(event.result).startsWith("ERROR:"))) throw new Error(events.find(event => String(event.result).startsWith("ERROR:")).result.slice(7));
    if (stopped) process.exitCode = 2;
    if (opts.json) printData({ answer, status: stopped ? "incomplete" : "completed", session_id: opts.noSession ? null : session.id, model: target.spec, profile, project: { root: project.root, commands: project.commands }, summary: { files: summary }, usage, events }, opts);
  } catch (err) {
    process.exitCode = 1;
    if (opts.json) printData({ status: "error", error: err.message, session_id: opts.noSession ? null : session.id, usage, events }, opts);
    else throw err;
  } finally { checkpoint.finalize(); persist(); }
}

// ---- interactive REPL ----

async function interactive({ target, system, tools, network, config, yolo, agents, commands, modelRef, resume, limits, fallbacks, ext = {}, readOnly = false, plan, maxStepsOverride, permissions, root, profile, project, bus, noSession = false }) {
  const cwd = root;
  let currentProfile = profile;
  let currentProject = project;
  let currentSystem = system;
  let currentTools = tools;
  const messages = [];
  let active = target;
  const session = { id: newSessionId(), name: null };
  const createContext = () => createRunContext({ bus, sessionId: session.id, cwd: root, satId: session.satId, satPersistence: !noSession });

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
        session.satId = s.satId;
        out(t.faint(`resumed ${s.id} · ${s.messages.length} messages`));
      }
    } catch (err) {
      out(t.danger(`could not resume: ${err.message}`));
    }
  }

  out("");
  await banner(active.spec, network, { animate: true });
  out("  " + t.faint(cwd));
  { const caps = detectCaps(); out("  " + (caps.level === "text" ? t.stageLegend() : welcomeSats(loadSats()))); }
  out("");
  out(t.faint("type a request, or /help for commands. Ctrl+D to quit."));
  out("");

  const menu = buildMenu(commands);
  const history = loadHistory();

  const checkpoint = new TurnCheckpoint(root);
  const approve = async (tc, tool, { signal } = {}) => {
    if (!requiresPaymentApproval(tool) && mayAutoApprove({ tool, args: tc.args, permissions })) return true;
    if (["write_file", "edit_file", "patch"].includes(tool.name)) out(previewMutation(tc));
    out(approvalCard({ satId: session.satId, tool: tool.name, financial: requiresPaymentApproval(tool), lang: satLang() }, detectCaps()));
    if (tool.readback) out("  " + t.bold(tool.readback(tc.args || {})));
    out(t.faint(JSON.stringify(tc.args || {}, null, 2)));
    const ans = await question("  " + t.accent("approve") + " " + t.bold(tool.name) + ` on ${network} (y/N) `, { signal });
    return /^y(es)?$/i.test(ans.trim());
  };

  const persist = () => {
    if (noSession) return;
    try {
      saveSession(cwd, { id: session.id, model: active.spec, network, messages, name: session.name, satId: session.satId });
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
          system: currentSystem,
          tools: currentTools,
          cwd,
          network,
          session,
          ext, limits: { ...agentLimits(config), ...(maxStepsOverride ? { maxSteps: maxStepsOverride } : {}) }, fallbacks: resolveFallbacks(config), approve, readOnly, plan, persist, createContext,
          getActive: () => active,
          profile: currentProfile, project: currentProject, permissions, checkpoint,
          setProfile: (next) => {
            currentProfile = next;
            config.profile = next;
            currentProject = discoverProject(root);
            currentSystem = systemPrompt({ profile: next, network, lightning: !!config.lightning?.lndRestUrl, project: currentProject }) + (next === "rgb" ? "" : "\n\n" + contextPrompt(root, loadSkills(root)));
            currentTools = buildTools(config, { modelRef, agents, system: currentSystem, skills: loadSkills(root), plan, profile: next, workspaceRoot: root, sandbox: permissions.sandbox });
          },
          setActive: (x) => {
            active = x;
            modelRef.current = x;
          },
        });
        if (stop === "exit") break;
        continue;
      }
    }

    checkpoint.reset();
    messages.push({ role: "user", content: expandMentions(input) });
    try {
      await runWithInterrupt({ target: active, system: currentSystem, messages, tools: currentTools, hooks: buildHooks({ approve, askUser: question, onCheckpoint: persist, checkpoint, onMutation: tc => { checkpoint.begin(tc); checkpoint.recordProtected(tc); } }), limits: { ...agentLimits(config), ...(maxStepsOverride ? { maxSteps: maxStepsOverride } : {}) }, fallbacks: resolveFallbacks(config), readOnly, context: createContext() });
    } catch (err) {
      out(t.danger(`error: ${err.message}`));
    }
    printTurnSummary(checkpoint.finalize());
    persist(); // auto-save after every completed turn
  }

  persist();
  out(t.faint(`${t.BOLT ? `\n${t.accent(t.BOLT)} ` : "\n"}bye`));
}

export async function handleSlash(input, ctx) {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(" ");
  switch (cmd) {
    case "sats":
      { const caps = detectCaps();
        if (caps.level !== "text") return out(satCards(loadSats(), caps));
        return printData(loadSats().map(({ id, role }) => ({ id, role }))); }
    case "sat": {
      try {
        const [action, name, extra] = rest;
        if (extra || !action || (name && !['info', 'workspace'].includes(action))) throw new Error('usage: /sat <name> | /sat info <name> | /sat workspace <name>');
        const sat = findSat(['info', 'workspace'].includes(action) ? name : action);
        if (action === 'info') return printData({ ...sat, ...satWorkspace(sat.id), history: satHistory(sat.id, { cwd: ctx.cwd }) });
        if (action === 'workspace') return out(satWorkspace(sat.id).workspace);
        ctx.session.satId = sat.id;
        ctx.persist?.();
        out(t.ok(`Sat: ${sat.name} · ${sat.role}`));
      } catch (error) { out(t.danger(error.message)); }
      return;
    }
    case "exit":
    case "quit":
      return "exit";
    case "reset":
      delete ctx.session.satId;
      ctx.messages.length = 0;
      ctx.session.id = newSessionId();
      ctx.session.name = null;
      if (ctx.plan) ctx.plan.steps = [];
      out(t.faint("history cleared"));
      return;
    case "tools":
      for (const tool of ctx.tools.filter(x => !arg || x.name.includes(arg))) out(`${tool.name}${isMutating(tool) ? " [approval]" : ""} — ${tool.description || ""}`);
      return;
    case "profile": {
      if (!arg) { out(t.faint(`profile: ${ctx.profile || "code"}`)); return; }
      if (!PROFILES.has(arg)) { out(t.danger("usage: /profile [code|bitcoin|rgb]")); return; }
      if (!ctx.setProfile) { out(t.danger("profile switching is unavailable in this command")); return; }
      try {
        ctx.setProfile(arg);
        saveConfig(ctx.config);
        out(t.ok(`switched to ${arg} profile`));
      } catch (err) { out(t.danger(`profile switch failed: ${err.message}`)); }
      return;
    }
    case "diff":
      out(ctx.checkpoint?.diff?.() || t.faint("No checkpoint for this turn."));
      return;
    case "undo": {
      const result = ctx.checkpoint?.undo?.() || { ok: false, error: "no agent checkpoint to undo" };
      if (result.ok) out(t.ok(`restored ${result.files.length} file(s): ${result.files.join(", ") || "no file changes"}`));
      else {
        out(t.danger(result.error));
        if (result.conflicts?.length) out(t.faint(`conflicts: ${result.conflicts.join(", ")}`));
      }
      return;
    }
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
      const entries = [];
      const active = ctx.getActive()?.spec;
      const row = (e, indent = "") => {
        entries.push(e);
        const mark = e.spec === active ? t.ok("●") : " ";
        out(`  ${t.faint(String(entries.length).padStart(2))} ${mark} ${indent}${e.line}`);
      };
      out(t.label("Providers"));
      for (const e of providerLines(ctx.config)) row(e);
      const local = await localSections(ctx.config);
      out(t.label("Local models (this machine)") + "  " + machineLine(local.machine));
      for (const section of local.sections) {
        out(`       ${section.header}`);
        for (const e of section.entries) row(e, "  ");
        if (section.hint) out(t.faint(`         ${section.hint}`));
      }
      for (const line of idleLines(local.idle)) out(`     ${line}`);
      out("");
      const ans = (await ctx.ask(t.faint("select # or type provider/model (enter to cancel): "))).trim();
      if (!ans) return;
      const chosen = /^\d+$/.test(ans) ? entries[Number(ans) - 1] : null;
      const spec = chosen ? chosen.spec : ans;
      if (chosen?.addProvider && ensureRuntimeProvider(ctx.config, chosen.addProvider)) out(t.faint(`added local provider ${chosen.addProvider} to ${configPath()}`));
      if (!spec) {
        out(t.danger(`no such entry: ${ans}`));
        return;
      }
      try {
        const next = resolveModel({ cliModel: spec, config: ctx.config });
        const nextConfig = { ...ctx.config, model: next.spec };
        const file = saveConfig(nextConfig);
        ctx.config.model = next.spec;
        ctx.setActive(next);
        out(t.ok(`switched to ${next.spec}`));
        // Remember the choice, like a normal settings change, so the next start uses it.
        out(t.faint(`saved as default model (${file})`));
        if (process.env.BITCODE_MODEL) out(t.faint("note: BITCODE_MODEL is set and still takes precedence at startup"));
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
      const persona = name === "--" ? null : findAgent(ctx.agents, name);
      const prompt = promptParts.join(" ");
      if (name !== "--" && !persona) {
        out(t.danger(`unknown agent "${name}"; use /subagent to list personas, or /subagent -- <prompt>`));
        return;
      }
      if (!prompt) {
        out(t.danger("usage: /subagent [name] <prompt>"));
        return;
      }
      out(t.faint(`— delegating to ${persona ? persona.name : "(default)"} —`));
      try {
        ctx.checkpoint?.reset();
        await withInterrupt(signal => runSubagent({ agent: persona?.name, prompt: expandMentions(prompt), agents: ctx.agents, target: ctx.getActive(), system: ctx.system, tools: ctx.tools, parentContext: { ...(ctx.createContext?.() || {}), runId: undefined }, approve: ctx.approve,
          signal, hooks: buildHooks({ askUser: ctx.ask, checkpoint: ctx.checkpoint, onMutation: tc => { ctx.checkpoint?.begin(tc); ctx.checkpoint?.recordProtected(tc); } }), limits: ctx.limits || agentLimits(ctx.config), fallbacks: ctx.fallbacks || resolveFallbacks(ctx.config), readOnly: ctx.readOnly }));
        printTurnSummary(ctx.checkpoint?.finalize());
      } catch (err) {
        out(t.danger(`error: ${err.message}`));
      }
      out(t.faint("— done —"));
      return;
    }
    case "skills": return printData(loadSkills());
    case "commands": return printData((ctx.commands || loadCommands()).map(({ name, description }) => ({ name, description })));
    case "mcp": return printData(ctx.ext?.mcpServers || []);
    case "status": return printData({ model: ctx.getActive().spec, profile: ctx.profile || "code", root: ctx.project?.root || ctx.cwd, commands: ctx.project?.commands || [], permissions: ctx.permissions ? { mode: ctx.permissions.mode, readOnly: ctx.permissions.readOnly, allow: [...ctx.permissions.allow] } : undefined, readOnly: !!ctx.readOnly, ...contextStats(ctx.messages), usage: ctx.messages.reduce((u, m) => ({ input_tokens: u.input_tokens + (m.usage?.input_tokens || 0), output_tokens: u.output_tokens + (m.usage?.output_tokens || 0) }), { input_tokens: 0, output_tokens: 0 }), plan: ctx.plan });
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
        const text = await runWithInterrupt({ target: ctx.getActive(), system: `${ctx.system}\nInvestigate the task using read-only tools. Return a concrete implementation plan with files, steps and verification. Do not implement changes.`, messages: [{ role: "user", content: expandMentions(arg) }], tools: ctx.tools, limits: ctx.limits || agentLimits(ctx.config), fallbacks: ctx.fallbacks || resolveFallbacks(ctx.config), readOnly: true, hooks: buildHooks({ askUser: ctx.ask }), context: ctx.createContext?.() });
        if (!text?.startsWith("[stopped:")) out(t.ok(`plan saved: ${savePlan(ctx.cwd, { task: arg, text })}`));
      } catch (err) { out(t.danger(err.message)); }
      return;
    }
    case "build": {
      const plan = latestPlan(ctx.cwd);
      if (!plan) return out(t.faint("no saved plan; use /plan <task>"));
      if (ctx.readOnly) return out(t.danger("restart without --read-only to implement the plan"));
      ctx.messages.push({ role: "user", content: `Implement this saved plan, inspect current files first, and verify the changes:\n${plan.text}` });
      try {
        ctx.checkpoint?.reset();
        await runWithInterrupt({ target: ctx.getActive(), system: ctx.system, messages: ctx.messages, tools: ctx.tools, limits: ctx.limits || agentLimits(ctx.config), fallbacks: ctx.fallbacks || resolveFallbacks(ctx.config), hooks: buildHooks({ approve: ctx.approve, askUser: ctx.ask, onCheckpoint: ctx.persist, checkpoint: ctx.checkpoint, onMutation: tc => { ctx.checkpoint?.begin(tc); ctx.checkpoint?.recordProtected(tc); } }), context: ctx.createContext?.() });
        printTurnSummary(ctx.checkpoint?.finalize());
      }
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
            satId: ctx.session.satId,
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
          ctx.session.satId = s.satId;
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
            satId: ctx.session.satId,
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
      out(t.faint("/plan <task>  /build  /compact  /status  /profile [code|bitcoin|rgb]  /diff  /undo  /skills  /mcp  /commands"));
      out(t.faint("/sats  /sat <name>  /sat info <name>  /sat workspace <name>  /tools [filter]  /reset  /exit"));
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
