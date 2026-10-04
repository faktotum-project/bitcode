// Development-only asset build. Install sharp locally or set SATS_SHARP_MODULE.
// Runtime consumes committed outputs and never runs this script.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const sharp = require(process.env.SATS_SHARP_MODULE || "sharp");
const root = fileURLToPath(new URL("../../", import.meta.url));
const base = path.join(root, "assets/sats");
const poses = ["idle", "focus", "working", "ask", "happy", "concerned"];
const agents = [
  { id: "node", name: "Node", role: "Infrastruttura Bitcoin", color: "#3297ff" },
  { id: "script", name: "Script", role: "Implementazione", color: "#f7931a" },
  { id: "hash", name: "Hash", role: "Analisi di sicurezza", color: "#b6f500" },
  { id: "merkle", name: "Merkle", role: "Orchestrazione", color: "#c96bff" },
];
const blank = (width, height) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
async function normalize(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width,
    top = info.height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  if (left > right || top > bottom) throw new Error("Empty sprite");
  const sprite = await sharp(input)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize({ width: 800, height: 856, fit: "inside" })
    .png()
    .toBuffer();
  const m = await sharp(sprite).metadata();
  return blank(1024, 1024)
    .composite([
      {
        input: sprite,
        left: Math.round((1024 - m.width) / 2),
        top: 920 - m.height,
      },
    ])
    .png()
    .toBuffer();
}
const sizes = [];
for (const agent of agents) {
  const dir = path.join(base, agent.id);
  await fs.mkdir(path.join(dir, "masters"), { recursive: true });
  const atlas = path.join(base, "sources", `${agent.id}-atlas.png`);
  const meta = await sharp(atlas).metadata();
  if (!meta.hasAlpha || meta.width % 3 || meta.height % 2)
    throw new Error(`Invalid atlas: ${agent.id}`);
  agent.poses = {};
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    const input =
      i === 0
        ? await fs.readFile(
            path.join(base, "sources", `${agent.id}-original.png`),
          )
        : await sharp(atlas)
            .extract({
              left: (i % 3) * (meta.width / 3),
              top: Math.floor(i / 3) * (meta.height / 2),
              width: meta.width / 3,
              height: meta.height / 2,
            })
            .png()
            .toBuffer();
    const master = await normalize(input);
    await fs.writeFile(path.join(dir, "masters", `${pose}-1024.png`), master);
    const webp = await sharp(master)
      .resize(256, 256)
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    await fs.writeFile(path.join(dir, `${pose}-256.webp`), webp);
    // Static fallbacks for every expression, not just idle.
    await sharp(master)
      .resize(256, 256)
      .png()
      .toFile(path.join(dir, `${pose}-256.png`));
    sizes.push({ agent: agent.id, pose, bytes: webp.length });
    agent.poses[pose] = `/assets/sats/${agent.id}/${pose}-256.webp`;
    if (pose === "idle") {
      // Dedicated head crop; the small avatar intentionally prioritises visor/eyes.
      await sharp(master)
        .extract({ left: 192, top: 180, width: 640, height: 640 })
        .resize(96, 96)
        .png()
        .toFile(path.join(dir, "avatar-96.png"));
    }
  }
  agent.poster = `/assets/sats/${agent.id}/idle-256.png`;
  agent.avatar = `/assets/sats/${agent.id}/avatar-96.png`;
  const frames = path.join(root, ".sats-build", agent.id);
  await fs.mkdir(frames, { recursive: true });
  const sprite = await sharp(path.join(dir, "masters/working-1024.png"))
    .resize(492, 492)
    .png()
    .toBuffer();
  for (let i = 0; i < 48; i++) {
    await blank(512, 512)
      .composite([
        {
          input: sprite,
          left: 10,
          top: 10 + Math.round(3 * Math.sin((i * 2 * Math.PI) / 48)),
        },
      ])
      .png()
      .toFile(path.join(frames, `${String(i).padStart(3, "0")}.png`));
  }
  const gif = path.join(frames, "working.gif");
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      "16",
      "-i",
      path.join(frames, "%03d.png"),
      "-filter_complex",
      "[0:v]split[a][b];[a]palettegen=max_colors=64:reserve_transparent=1[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
      "-loop",
      "0",
      "-gifflags",
      "0",
      gif,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || "ffmpeg is required to export GIFs");
  if ((await fs.stat(gif)).size > 2 * 1024 * 1024)
    throw new Error(`GIF budget exceeded: ${agent.id}`);
  await fs.copyFile(gif, path.join(dir, "working.gif"));
  // Product brand cards use actual Bitcode tokens. Lettering remains separate from the mascot.
  const pose = await sharp(path.join(dir, "masters/idle-1024.png"))
    .resize(820, 820)
    .png()
    .toBuffer();
  for (const [theme, bg, ink, body] of [
    ["light", "#f7f7f4", "#26251e", "#5a5852"],
    ["ink", "#26251e", "#f7f7f4", "#cfcdc4"],
  ]) {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280"><rect width="1280" height="1280" fill="${bg}"/><text x="72" y="108" fill="${ink}" font-family="Inter,Arial,sans-serif" font-size="54" font-weight="400">sats</text><text x="206" y="104" fill="${body}" font-family="monospace" font-size="24">by bitcode</text><text x="640" y="1100" text-anchor="middle" fill="${ink}" font-family="Inter,Arial,sans-serif" font-size="76" font-weight="400">${agent.name}</text><text x="640" y="1160" text-anchor="middle" fill="${body}" font-family="monospace" font-size="26">${agent.role}</text></svg>`,
    );
    await sharp(svg)
      .composite([{ input: pose, left: 230, top: 200 }])
      .png()
      .toFile(path.join(dir, `brand-${theme}.png`));
  }
}
const report = {
  sourceCellPixels: 512,
  masterPixels: 1024,
  note: "Non-idle masters are normalised/resampled from 512px cells; retain source atlases.",
  runtimeWebpBytes: sizes.reduce((n, a) => n + a.bytes, 0),
  initialIdleBytes: sizes
    .filter((a) => a.pose === "idle")
    .reduce((n, a) => n + a.bytes, 0),
  files: sizes,
};
if (
  report.runtimeWebpBytes > 2 * 1024 * 1024 ||
  report.initialIdleBytes > 400 * 1024 ||
  sizes.some((a) => a.bytes > 100 * 1024)
)
  throw new Error("Runtime image budget exceeded");
await fs.writeFile(
  path.join(base, "manifest.json"),
  JSON.stringify({ version: 1, agents }, null, 2) + "\n",
);
await fs.writeFile(
  path.join(base, "sizes.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
