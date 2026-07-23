/**
 * Golazo ingestion.
 *
 * Two modes, by design:
 *
 *   npm run ingest            offline. Builds the store from the committed seed
 *                             so the API runs with no key and no network.
 *   npm run ingest:refresh    pulls the full fixture list from football-data.org
 *                             and merges it over the seed. Needs FOOTBALL_DATA_KEY.
 *
 * The seed always wins on conflicts. Seeded matches were cross checked by hand
 * against public sources, so an imported record never silently overwrites a
 * verified one. Conflicts are reported instead.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import type { Dataset, Match, Team } from "../src/types.js";

const SEED_PATH = path.join(__dirname, "..", "data", "worldcup2026.seed.json");
const OUT_PATH = path.join(__dirname, "..", "data", "worldcup2026.json");
const API_BASE = "https://api.football-data.org/v4";

function loadSeed(): Dataset {
  const raw = fs.readFileSync(SEED_PATH, "utf8");
  return JSON.parse(raw) as Dataset;
}

function stageFromApi(stage: string): Match["stage"] | null {
  const map: Record<string, Match["stage"]> = {
    GROUP_STAGE: "group",
    LAST_32: "round_of_32",
    LAST_16: "round_of_16",
    QUARTER_FINALS: "quarter_final",
    SEMI_FINALS: "semi_final",
    THIRD_PLACE: "third_place",
    FINAL: "final",
  };
  return map[stage] ?? null;
}

async function fetchUpstream(key: string): Promise<{ matches: Match[]; teams: Team[] }> {
  const res = await fetch(`${API_BASE}/competitions/WC/matches`, {
    headers: { "X-Auth-Token": key },
  });
  if (!res.ok) {
    throw new Error(
      `football-data.org returned ${res.status}. Check FOOTBALL_DATA_KEY and that the free tier covers this competition.`
    );
  }
  const body: any = await res.json();
  const matches: Match[] = [];
  const teams = new Map<string, Team>();

  for (const m of body.matches ?? []) {
    const stage = stageFromApi(m.stage);
    if (!stage) continue;
    const home = m.homeTeam?.tla ?? m.homeTeam?.shortName;
    const away = m.awayTeam?.tla ?? m.awayTeam?.shortName;
    if (!home || !away) continue;

    if (m.homeTeam?.tla) {
      teams.set(m.homeTeam.tla, { id: m.homeTeam.tla, name: m.homeTeam.name, code: m.homeTeam.tla });
    }
    if (m.awayTeam?.tla) {
      teams.set(m.awayTeam.tla, { id: m.awayTeam.tla, name: m.awayTeam.name, code: m.awayTeam.tla });
    }

    matches.push({
      id: `wc2026-api-${m.id}`,
      stage,
      date: (m.utcDate ?? "").slice(0, 10),
      homeTeam: home,
      awayTeam: away,
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
      provenance: "imported",
    });
  }
  return { matches, teams: [...teams.values()] };
}

/** Same fixture regardless of which source named it. */
function fixtureKey(m: Match): string {
  return [m.stage, m.date, m.homeTeam, m.awayTeam].join("|");
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const dataset = loadSeed();
  const conflicts: string[] = [];

  if (refresh) {
    const key = process.env.FOOTBALL_DATA_KEY;
    if (!key) {
      console.error(
        "error: --refresh needs FOOTBALL_DATA_KEY. Get a free key at football-data.org, then:\n" +
          "  FOOTBALL_DATA_KEY=yourkey npm run ingest:refresh"
      );
      process.exit(2);
    }

    let upstream;
    try {
      upstream = await fetchUpstream(key);
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      console.error("The seed is unchanged. The API still runs offline with npm run ingest.");
      process.exit(2);
    }

    const seeded = new Map(dataset.matches.map((m) => [fixtureKey(m), m]));
    let added = 0;

    for (const m of upstream.matches) {
      const existing = seeded.get(fixtureKey(m));
      if (existing) {
        // seed wins, but report any disagreement rather than hiding it
        if (existing.homeScore !== m.homeScore || existing.awayScore !== m.awayScore) {
          conflicts.push(
            `${existing.id}: seed says ${existing.homeScore}-${existing.awayScore}, ` +
              `upstream says ${m.homeScore}-${m.awayScore}. Seed kept.`
          );
        }
        continue;
      }
      dataset.matches.push(m);
      added++;
    }

    const known = new Set(dataset.teams.map((t) => t.id));
    for (const t of upstream.teams) {
      if (!known.has(t.id)) dataset.teams.push(t);
    }

    dataset.meta.source = "seed + football-data.org";
    dataset.meta.coverage = "full";
    console.log(`refresh: added ${added} matches, ${dataset.teams.length} teams total`);
  }

  dataset.meta.generatedAt = new Date().toISOString().slice(0, 10);
  dataset.matches.sort((a, b) => a.date.localeCompare(b.date));

  fs.writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2) + "\n");

  console.log(`wrote ${OUT_PATH}`);
  console.log(`  matches: ${dataset.matches.length}`);
  console.log(`  teams:   ${dataset.teams.length}`);
  console.log(`  source:  ${dataset.meta.source}`);
  if (conflicts.length) {
    console.log("\nconflicts, seed values kept:");
    for (const c of conflicts) console.log(`  ${c}`);
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
