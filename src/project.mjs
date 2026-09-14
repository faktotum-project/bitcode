import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const PROFILES = new Set(["code", "bitcoin"]);

export function projectRoot(cwd = process.cwd()) {
  return realpathSync(path.resolve(cwd));
}

function json(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

// Deliberately use only package/configuration signals. A README can mention
// Bitcoin for all sorts of reasons and must never change the safety profile.
export function detectsBitcoinProject(cwd = process.cwd()) {
  const root = projectRoot(cwd);
  const configNames = [
    "bitcoin.conf", "lnd.conf", "cln.conf", "lightningd.conf", "tapd.conf",
    "cashu.toml", "cashu.json", "wavelength.toml", "wavelength.json",
  ];
  if (configNames.some(name => existsSync(path.join(root, name)))) return true;
  const pkg = json(path.join(root, "package.json"));
  const names = Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.peerDependencies || {}) });
  const known = /(?:^|[\/@_-])(bitcoin-core|bitcoind-rpc|bitcoinjs-lib|ln-service|lnd-grpc|lightning|cashu|taproot-assets?|tapd|wavelength)(?:$|[\/@_-])/i;
  return known.test(String(pkg?.name || "")) || names.some(name => known.test(name));
}

export function resolveProfile({ cliProfile, config = {}, cwd = process.cwd() } = {}) {
  const requested = cliProfile ?? config.profile;
  if (requested != null) {
    if (!PROFILES.has(requested)) throw new Error(`invalid profile "${requested}"; use code or bitcoin`);
    return requested;
  }
  return detectsBitcoinProject(cwd) ? "bitcoin" : "code";
}

export function discoverProject(cwd = process.cwd()) {
  const root = projectRoot(cwd);
  const files = {
    package: path.join(root, "package.json"), make: path.join(root, "Makefile"),
    pyproject: path.join(root, "pyproject.toml"), cargo: path.join(root, "Cargo.toml"), go: path.join(root, "go.mod"),
  };
  const commands = [];
  const add = (command, kind) => { if (!commands.some(x => x.command === command)) commands.push({ command, kind }); };
  const pkg = json(files.package);
  if (pkg?.scripts && typeof pkg.scripts === "object") {
    for (const [name] of Object.entries(pkg.scripts)) {
      if (/^(test|lint|build)(?::|$)/.test(name)) add(`npm run ${name}`, name.split(":")[0]);
    }
  }
  if (existsSync(files.make)) {
    const text = readFileSync(files.make, "utf8");
    for (const name of ["test", "lint", "build"]) if (new RegExp(`^${name}\\s*:` , "m").test(text)) add(`make ${name}`, name);
  }
  if (existsSync(files.pyproject)) {
    const text = readFileSync(files.pyproject, "utf8");
    if (/pytest|\[tool\.pytest/i.test(text)) add("pytest", "test");
    if (/ruff/i.test(text)) add("ruff check .", "lint");
  }
  if (existsSync(files.cargo)) { add("cargo test", "test"); add("cargo build", "build"); }
  if (existsSync(files.go)) { add("go test ./...", "test"); add("go build ./...", "build"); }
  return { root, files: Object.fromEntries(Object.entries(files).filter(([, file]) => existsSync(file))), commands };
}

function contains(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}

// Resolves both existing paths and paths whose final component does not exist.
// Every existing ancestor is realpathed, preventing traversal through symlinks.
export function resolveWorkspacePath(root, input = ".") {
  const realRoot = projectRoot(root);
  const candidate = path.resolve(realRoot, input);
  if (!contains(realRoot, candidate)) throw new Error("path is outside the project root");
  let ancestor = candidate;
  const suffix = [];
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("path has no existing ancestor");
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = realpathSync(ancestor);
  if (!contains(realRoot, realAncestor)) throw new Error("path resolves outside the project root through a symlink");
  const resolved = suffix.length ? path.join(realAncestor, ...suffix) : realAncestor;
  if (!contains(realRoot, resolved)) throw new Error("path resolves outside the project root");
  return resolved;
}

export function relativeProjectPath(root, file) {
  return path.relative(projectRoot(root), file).split(path.sep).join("/") || ".";
}
