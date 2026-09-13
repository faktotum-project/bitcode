import { homedir } from "node:os";
import path from "node:path";
export function bitcodeHome() { return process.env.BITCODE_HOME ? path.resolve(process.env.BITCODE_HOME) : path.join(homedir(), ".bitcode"); }
