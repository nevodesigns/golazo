import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Dataset, Match, Team } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "..", "..", "data", "worldcup2026.json");

let cache: Dataset | null = null;

export function load(): Dataset {
  if (cache) return cache;
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(
      "dataset not found. Run `npm run ingest` first to build it from the seed."
    );
  }
  cache = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as Dataset;
  return cache;
}

export function teams(): Team[] {
  return load().teams;
}

export function findTeam(idOrName: string): Team | undefined {
  const q = idOrName.trim().toLowerCase();
  return load().teams.find(
    (t) => t.id.toLowerCase() === q || t.code.toLowerCase() === q || t.name.toLowerCase() === q
  );
}

export function matches(filter?: { stage?: string; team?: string }): Match[] {
  let list = load().matches;
  if (filter?.stage) list = list.filter((m) => m.stage === filter.stage);
  if (filter?.team) {
    const t = filter.team.toUpperCase();
    list = list.filter((m) => m.homeTeam === t || m.awayTeam === t);
  }
  return list;
}

export function findMatch(id: string): Match | undefined {
  return load().matches.find((m) => m.id === id);
}

/** Matches a team actually played, with scores recorded. */
export function playedBy(teamId: string): Match[] {
  return matches({ team: teamId }).filter(
    (m) => m.homeScore !== null && m.awayScore !== null
  );
}
