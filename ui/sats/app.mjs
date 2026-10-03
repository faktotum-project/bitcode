import { reduceEvent } from "/ui/state.mjs";

const $ = (id) => document.getElementById(id);
const labels = {
  idle: "Pronto",
  thinking: "Sta pensando",
  responding: "Sta rispondendo",
  reading: "Sta leggendo",
  running: "Sta eseguendo",
  drafting: "Sta modificando",
  awaiting_approval: "In attesa di conferma",
  success: "Completato",
  error: "Da verificare",
  cancelled: "Interrotto",
  delegating: "Delega in corso",
};
const poses = {
  idle: "idle",
  thinking: "focus",
  responding: "focus",
  reading: "focus",
  running: "working",
  drafting: "working",
  awaiting_approval: "ask",
  success: "happy",
  error: "concerned",
  cancelled: "idle",
};
let registry = [],
  state = { seq: 0, runs: {}, activity: [] },
  selected = null;
let source;
const cards = new Map(),
  visible = new Map();
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
async function api(route, options = {}) {
  const response = await fetch(route, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Richiesta non completata.");
  return data;
}
function connection(ok) {
  document.body.classList.toggle("connected", ok);
  document.body.classList.toggle("disconnected", !ok);
  $("connection-label").textContent = ok
    ? "Collegato · locale"
    : "Collegamento interrotto · stato non aggiornato";
}
function selectAgent(id) {
  selected = id;
  for (const [key, card] of cards)
    card.button.setAttribute("aria-pressed", String(id === key));
  $("activity-title").textContent =
    (registry.find((a) => a.id === id)?.name || "Bitcode") + " · attività";
  $("all-activity").hidden = false;
  renderActivity();
}
function createCards() {
  $("sats").replaceChildren();
  for (const [i, agent] of registry.entries()) {
    const button = el("button", "sat");
    button.type = "button";
    button.dataset.agent = agent.id;
    button.dataset.state = "idle";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute(
      "aria-label",
      `${agent.name}, ${agent.role}. Seleziona attività.`,
    );
    const top = el("div", "sat-top mono"),
      dot = el("span", "identity");
    dot.style.backgroundColor = agent.color;
    top.append(el("span", "", `SAT / 0${i + 1}`), dot);
    const avatar = el("div", "avatar"),
      picture = el("picture"),
      webp = el("source"),
      img = el("img");
    webp.type = "image/webp";
    webp.srcset = agent.poses.idle;
    img.src = agent.poster;
    img.width = 144;
    img.height = 144;
    img.alt = "";
    img.addEventListener("error", () => {
      if (img.dataset.fallback === "1") {
        picture.hidden = true;
        return;
      }
      img.dataset.fallback = "1";
      webp.removeAttribute("srcset");
      img.src = agent.poses[cards.get(agent.id)?.pose || "idle"].replace(
        /\.webp$/,
        ".png",
      );
    });
    picture.append(webp, img);
    avatar.append(picture);
    const status = el("span", "sat-state", labels.idle);
    const operation = el("span", "sat-operation", "Nessuna operazione");
    button.append(
      top,
      avatar,
      el("span", "sat-name", agent.name),
      el("span", "sat-role", agent.role),
      status,
      operation,
    );
    button.addEventListener("click", () => selectAgent(agent.id));
    cards.set(agent.id, { button, webp, img, status, operation, pose: "idle" });
    $("sats").append(button);
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries)
      visible.set(entry.target.dataset.agent, entry.isIntersecting);
    pauseInvisible();
  });
  for (const card of cards.values()) observer.observe(card.button);
}
function pauseInvisible() {
  for (const [id, card] of cards)
    card.button.classList.toggle(
      "paused",
      document.hidden || visible.get(id) === false,
    );
}
function latestRun(id) {
  return Object.values(state.runs)
    .filter((r) => r.agentId === id)
    .at(-1);
}
function renderCards(celebrateId = null) {
  for (const agent of registry) {
    const run = latestRun(agent.id),
      card = cards.get(agent.id),
      current = run?.state || "idle",
      pose = poses[current] || "idle";
    card.button.dataset.state = current;
    card.status.textContent =
      current === "awaiting_approval"
        ? "Conferma nel terminale"
        : labels[current] || current;
    const activeTool = Object.values(run?.tools || {}).findLast(t => t.status !== "requested");
    card.operation.textContent = activeTool?.summary || run?.lastTool?.summary || "Nessuna operazione";
    if (pose !== card.pose) {
      card.img.dataset.fallback = "";
      card.img.parentElement.hidden = false;
      card.webp.srcset = agent.poses[pose];
      card.img.src = agent.poses[pose].replace(/\.webp$/, ".png");
      card.pose = pose;
    }
    if (current !== "success") card.button.classList.remove("celebrate");
    if (celebrateId === run?.runId && current === "success") {
      card.button.classList.add("celebrate");
      setTimeout(() => card.button.classList.remove("celebrate"), 750);
    }
  }
  const active = Object.values(state.runs).filter(
    (r) => !["success", "error", "cancelled"].includes(r.state),
  );
  const parent = active.find((r) => !r.parentRunId);
  $("parent-status").textContent = parent
    ? `${registry.find((a) => a.id === parent.agentId)?.name || parent.displayName || parent.agentId} · ${labels[parent.state] || parent.state}${parent.childAgentId ? " · " + parent.childAgentId : ""}`
    : "Nessuna delega in corso.";
}
function activityText(event) {
  const { type, data } = event;
  if (type === "run.started") return ["●", "thinking", "Delega avviata", ""];
  if (type === "approval.requested")
    return [
      "○",
      "approval",
      "Conferma nel terminale · " + data.tool,
      "",
    ];
  if (type === "approval.resolved")
    return [
      data.outcome === "approved" ? "✓" : "⊘",
      "approval",
      data.outcome === "approved"
        ? "Operazione approvata"
        : "Operazione rifiutata",
      "",
    ];
  if (type === "tool.started") return ["●", data.stage, data.summary, ""];
  if (type === "tool.finished")
    return [
      data.outcome === "ok" ? "✓" : data.outcome === "denied" ? "⊘" : "✗",
      data.stage,
      `${data.summary} · ${data.outcome === "ok" ? "completato" : data.outcome === "denied" ? "rifiutato" : data.outcome === "cancelled" ? "interrotto" : "errore"}`,
      data.outcome === "ok" ? "ok" : data.outcome === "denied" ? "" : "error",
    ];
  if (type === "run.finished")
    return [
      data.outcome === "ok" ? "✓" : "—",
      "done",
      data.outcome === "ok"
        ? "Delega completata"
        : data.outcome === "cancelled"
          ? "Delega interrotta"
          : data.outcome === "max_steps"
            ? "Limite di passaggi raggiunto"
            : "Delega da verificare",
      data.outcome === "ok" ? "ok" : "error",
    ];
  return null;
}
function renderActivity() {
  const rows = state.activity
    .filter((e) => !selected || e.agentId === selected)
    .filter((e) => activityText(e))
    .slice(-40);
  $("activity").replaceChildren();
  if (!rows.length) {
    $("activity").append(
      el("li", "empty", "Nessuna operazione registrata per questa selezione."),
    );
    return;
  }
  for (const event of rows) {
    const [mark, stage, text, outcome] = activityText(event),
      li = el("li"),
      summary = el("span", "summary", text);
    summary.append(
      el(
        "span",
        "who",
        (registry.find((a) => a.id === event.agentId)?.name || event.displayName || event.agentId) +
          (event.data.durationMs != null
            ? ` · ${(event.data.durationMs / 1000).toFixed(1)} s`
            : ""),
      ),
    );
    li.append(
      el("span", "mark " + outcome, mark),
      el("time", "stamp", new Date(event.at).toLocaleTimeString("it-IT")),
      el("span", "pill " + (stage || "thinking"), stage || "thinking"),
      summary,
    );
    $("activity").append(li);
  }
}
function applyEvent(event, live) {
  if (event.seq <= state.seq) return;
  reduceEvent(state, event);
  renderCards(
    live && event.type === "run.finished" && event.data.outcome === "ok"
      ? event.runId
      : null,
  );
  renderActivity();
  if (
    live &&
    ["run.started", "approval.requested", "run.finished"].includes(event.type)
  ) {
    $("announcer").textContent =
      `${event.displayName || event.agentId}: ${activityText(event)?.[2] || "stato aggiornato"}`;
  }
}
function connectEvents() {
  source = new EventSource("/api/events");
  source.addEventListener("open", () => connection(true));
  source.addEventListener("error", () => connection(false));
  source.addEventListener("snapshot", (event) => {
    state = JSON.parse(event.data);
    renderCards();
    renderActivity();
  });
  source.addEventListener("activity", (event) =>
    applyEvent(JSON.parse(event.data), true),
  );
  source.addEventListener("replay", (event) =>
    applyEvent(JSON.parse(event.data), false),
  );
}
$("all-activity").addEventListener("click", () => {
  selected = null;
  for (const card of cards.values())
    card.button.setAttribute("aria-pressed", "false");
  $("activity-title").textContent = "Attività dei Sats";
  $("all-activity").hidden = true;
  renderActivity();
});
try {
  $("motion-off").checked = localStorage.getItem("sats.motionOff") === "true";
} catch {}
document.body.classList.toggle("motion-off", $("motion-off").checked);
$("motion-off").addEventListener("change", () => {
  document.body.classList.toggle("motion-off", $("motion-off").checked);
  try {
    localStorage.setItem("sats.motionOff", String($("motion-off").checked));
  } catch {}
});
document.addEventListener("visibilitychange", pauseInvisible);
window.addEventListener("pagehide", () => {
  source?.close();
});

async function start() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  // Remove the secret before any other navigation or request.
  if (location.hash) history.replaceState(null, "", location.pathname);
  if (token)
    await api("/api/attach", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  const bootstrap = await api("/api/bootstrap");
  registry = bootstrap.registry;
  state = bootstrap.snapshot;
  for (const [key, value] of Object.entries({
    ...bootstrap.tokens,
    ...bootstrap.stages,
  })) {
    if (/^#[a-f0-9]{6}$/i.test(value))
      document.documentElement.style.setProperty("--" + key, value);
  }
  $("network").textContent = bootstrap.network;
  $("mode-label").textContent = "Solo osservazione";
  createCards();
  renderCards();
  renderActivity();
  connectEvents();
}
start().catch((e) => {
  connection(false);
  error(e.message);
});
