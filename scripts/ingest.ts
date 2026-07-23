/**
 * Golazo ingestion.
 *
 * Two modes, by design:
 *
 *   npm run ingest            offline. Builds the store from the committed seed
 *                             so the API runs with no key and no network.
 *   npm run ingest:refresh    pulls the full tournament (matches, teams, groups)
 *                             from football-data.org and merges it over the
 *                             seed. Needs FOOTBALL_DATA_KEY.
 *
 * Provenance is preserved. The seed's hand verified knockout records (with goal
 * timelines, venue, and extra time flags) win over the imported feed: an
 * imported record never overwrites a verified one, and any disagreement is
 * reported rather than hidden. Group stage and the remaining knockout fixtures
 * come from the feed marked "imported".
 *
 * Pass --write-seed to also persist the enriched result back to the seed file,
 * so a later offline run has the complete dataset with no key.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Dataset, Match, Team, Group } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "..", "data", "worldcup2026.seed.json");
const OUT_PATH = path.join(__dirname, "..", "data", "worldcup2026.json");
const API_BASE = "https://api.football-data.org/v4";

function loadSeed(): Dataset {
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as Dataset;
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

async function apiGet(pathname: string, key: string): Promise<any> {
  const res = await fetch(`${API_BASE}${pathname}`, { headers: { "X-Auth-Token": key } });
  if (!res.ok) {
    throw new Error(
      `football-data.org ${pathname} returned ${res.status}. ` +
        `Check FOOTBALL_DATA_KEY and that the free tier covers this competition.`
    );
  }
  return res.json();
}

interface Upstream {
  matches: Match[];
  teams: Team[];
  groups: Group[];
}

async function fetchUpstream(key: string): Promise<Upstream> {
  const [matchBody, teamBody, standingBody] = await Promise.all([
    apiGet("/competitions/WC/matches", key),
    apiGet("/competitions/WC/teams", key),
    apiGet("/competitions/WC/standings", key),
  ]);

  const teamMeta = new Map<string, { name: string; confederation?: string }>();
  for (const t of teamBody.teams ?? []) {
    if (t.tla) teamMeta.set(t.tla, { name: t.name });
  }

  // Groups from the standings tables, and each team's group.
  const groups: Group[] = [];
  const teamGroup = new Map<string, string>();
  for (const s of standingBody.standings ?? []) {
    if (s.type !== "TOTAL" || !s.group) continue;
    const name = String(s.group);
    const codes = (s.table ?? [])
      .map((row: any) => row.team?.tla)
      .filter(Boolean);
    groups.push({ name, teams: codes });
    for (const c of codes) teamGroup.set(c, name);
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));

  const teams = new Map<string, Team>();
  const matches: Match[] = [];

  for (const m of matchBody.matches ?? []) {
    const stage = stageFromApi(m.stage);
    if (!stage) continue;
    const home = m.homeTeam?.tla;
    const away = m.awayTeam?.tla;
    if (!home || !away) continue;

    for (const t of [m.homeTeam, m.awayTeam]) {
      if (t?.tla && !teams.has(t.tla)) {
        teams.set(t.tla, {
          id: t.tla,
          name: teamMeta.get(t.tla)?.name ?? t.name ?? t.tla,
          code: t.tla,
          group: teamGroup.get(t.tla),
        });
      }
    }

    matches.push({
      id: `wc2026-${stage}-${home.toLowerCase()}-${away.toLowerCase()}-${(m.utcDate ?? "").slice(0, 10)}`,
      stage,
      date: (m.utcDate ?? "").slice(0, 10),
      homeTeam: home,
      awayTeam: away,
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
      provenance: "imported",
    });
  }

  return { matches, teams: [...teams.values()], groups };
}

/** Knockout fixtures identified by stage and the unordered team pair, so a
 *  verified record and its feed counterpart reconcile even if dates differ. */
function knockoutKey(m: Match): string {
  return [m.stage, [m.homeTeam, m.awayTeam].sort().join("-")].join("|");
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const writeSeed = process.argv.includes("--write-seed");
  const dataset = loadSeed();
  const conflicts: string[] = [];

  if (refresh) {
    const key = process.env.FOOTBALL_DATA_KEY;
    if (!key) {
      console.error(
        "error: --refresh needs FOOTBALL_DATA_KEY. Put it in .env or pass it inline:\n" +
          "  FOOTBALL_DATA_KEY=yourkey npm run ingest:refresh"
      );
      process.exit(2);
    }

    let upstream: Upstream;
    try {
      upstream = await fetchUpstream(key);
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      console.error("The seed is unchanged. The API still runs offline with npm run ingest.");
      process.exit(2);
    }

    // The verified knockout records already in the seed win. Reconcile each
    // against its feed counterpart: adopt the feed's authoritative date, keep
    // the verified score and rich detail, and report any score disagreement.
    const verified = dataset.matches.filter((m) => m.provenance === "verified");
    const verifiedKeys = new Set(verified.map(knockoutKey));
    const upstreamByKey = new Map(upstream.matches.map((m) => [knockoutKey(m), m]));

    // Result as a per-team map, so a home/away orientation difference is not
    // mistaken for a disagreement. Only a genuinely different score is.
    const resultMap = (m: Match): string =>
      JSON.stringify(
        Object.fromEntries(
          [
            [m.homeTeam, m.homeScore],
            [m.awayTeam, m.awayScore],
          ].sort()
        )
      );

    for (const v of verified) {
      const u = upstreamByKey.get(knockoutKey(v));
      if (!u) continue;
      if (resultMap(v) !== resultMap(u)) {
        conflicts.push(
          `${v.id}: verified result differs from feed (${u.homeTeam} ${u.homeScore}-${u.awayScore} ${u.awayTeam}). Verified kept.`
        );
        continue; // genuine disagreement, keep the verified record untouched
      }
      // Same result. Adopt the feed's authoritative home/away, score, and date,
      // and keep the verified rich detail (goals, venue, extra time). Goals are
      // keyed by team code, so they stay correct under the flip.
      v.homeTeam = u.homeTeam;
      v.awayTeam = u.awayTeam;
      v.homeScore = u.homeScore;
      v.awayScore = u.awayScore;
      if (u.date) v.date = u.date;
    }

    // Everything from the feed that is not a verified fixture is added as imported.
    const added: Match[] = upstream.matches.filter((m) => !verifiedKeys.has(knockoutKey(m)));
    dataset.matches = [...verified, ...added];

    dataset.teams = upstream.teams;   // authoritative 48 with group tags
    dataset.groups = upstream.groups; // authoritative 12
    dataset.meta.source = "seed (verified knockout) + football-data.org";
    dataset.meta.coverage = "full";
    console.log(
      `refresh: ${verified.length} verified kept, ${added.length} imported, ` +
        `${dataset.teams.length} teams, ${dataset.groups.length} groups`
    );
  }

  dataset.meta.generatedAt = new Date().toISOString().slice(0, 10);
  dataset.matches.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const json = JSON.stringify(dataset, null, 2) + "\n";
  fs.writeFileSync(OUT_PATH, json);
  if (writeSeed) {
    fs.writeFileSync(SEED_PATH, json);
    console.log(`updated seed: ${SEED_PATH}`);
  }

  console.log(`wrote ${OUT_PATH}`);
  console.log(`  matches: ${dataset.matches.length}`);
  console.log(`  teams:   ${dataset.teams.length}`);
  console.log(`  groups:  ${dataset.groups.length}`);
  console.log(`  source:  ${dataset.meta.source}`);
  if (conflicts.length) {
    console.log("\nconflicts, verified values kept:");
    for (const c of conflicts) console.log(`  ${c}`);
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
