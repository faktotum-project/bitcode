import { readFileSync } from "node:fs";
import { SAT_IDS } from "./policy.mjs";
export const POSES = ["idle", "focus", "working", "ask", "happy", "concerned"];
export function loadRegistry(
  file = new URL("../../assets/sats/manifest.json", import.meta.url),
) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.version !== 1 || manifest.agents?.length !== 4)
    throw new Error("Invalid Sats manifest version or agent count.");
  for (const [i, agent] of manifest.agents.entries()) {
    if (
      agent.id !== SAT_IDS[i] ||
      typeof agent.name !== "string" ||
      typeof agent.role !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(agent.color)
    )
      throw new Error("Invalid Sats identity.");
    if (
      !agent.poses ||
      Object.keys(agent.poses).length !== POSES.length ||
      Object.keys(agent.poses).some((p) => !POSES.includes(p))
    )
      throw new Error("Invalid Sats poses.");
    for (const asset of [
      agent.poster,
      agent.avatar,
      ...POSES.map((p) => agent.poses?.[p]),
    ]) {
      if (
        typeof asset !== "string" ||
        !new RegExp(`^/assets/sats/${agent.id}/[a-z0-9-]+\\.(png|webp)$`).test(
          asset,
        )
      )
        throw new Error("Invalid Sats asset path.");
    }
  }
  return manifest.agents.map(({ id, name, role, color, poses, poster, avatar }) => ({ id, name, role, color, poses, poster, avatar }));
}
