// Derived analytics. Everything here is computed from recorded match results,
// never invented. If the dataset has no matches for a team, the caller gets an
// explicit empty result rather than a fabricated one.
import { playedBy, findTeam, load } from "./store.js";
import type { Match } from "../types.js";

export interface TeamPerformance {
  team: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  cleanSheets: number;
  biggestWin: string | null;
  stagesReached: string[];
}

function resultFor(m: Match, teamId: string) {
  const home = m.homeTeam === teamId;
  const gf = (home ? m.homeScore : m.awayScore) ?? 0;
  const ga = (home ? m.awayScore : m.homeScore) ?? 0;
  return { gf, ga, opponent: home ? m.awayTeam : m.homeTeam };
}

export function teamPerformance(teamId: string): TeamPerformance | null {
  const team = findTeam(teamId);
  if (!team) return null;
  const played = playedBy(team.id);

  let won = 0, drawn = 0, lost = 0, goalsFor = 0, goalsAgainst = 0, cleanSheets = 0;
  let biggestWin: string | null = null;
  let bestMargin = 0;

  for (const m of played) {
    const { gf, ga, opponent } = resultFor(m, team.id);
    goalsFor += gf;
    goalsAgainst += ga;
    if (ga === 0) cleanSheets++;
    if (gf > ga) {
      won++;
      if (gf - ga > bestMargin) {
        bestMargin = gf - ga;
        biggestWin = `${gf}-${ga} v ${opponent} (${m.stage})`;
      }
    } else if (gf === ga) drawn++;
    else lost++;
  }

  return {
    team: team.id,
    name: team.name,
    played: played.length,
    won, drawn, lost,
    goalsFor, goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    cleanSheets,
    biggestWin,
    stagesReached: [...new Set(played.map((m) => m.stage))],
  };
}

export function headToHead(aId: string, bId: string) {
  const a = findTeam(aId);
  const b = findTeam(bId);
  if (!a || !b) return null;

  const meetings = playedBy(a.id).filter(
    (m) => m.homeTeam === b.id || m.awayTeam === b.id
  );

  let aWins = 0, bWins = 0, draws = 0, aGoals = 0, bGoals = 0;
  for (const m of meetings) {
    const { gf, ga } = resultFor(m, a.id);
    aGoals += gf;
    bGoals += ga;
    if (gf > ga) aWins++;
    else if (gf < ga) bWins++;
    else draws++;
  }

  return {
    teams: [a.id, b.id],
    names: [a.name, b.name],
    meetings: meetings.length,
    record: { [a.id]: aWins, [b.id]: bWins, draws },
    goals: { [a.id]: aGoals, [b.id]: bGoals },
    matches: meetings,
    note: meetings.length === 0
      ? "These teams did not meet in this tournament."
      : undefined,
  };
}

export function matchAnalytics(m: Match) {
  const total = (m.homeScore ?? 0) + (m.awayScore ?? 0);
  const margin = Math.abs((m.homeScore ?? 0) - (m.awayScore ?? 0));
  const winner =
    m.homeScore === null || m.awayScore === null
      ? null
      : m.homeScore > m.awayScore
        ? m.homeTeam
        : m.awayScore > m.homeScore
          ? m.awayTeam
          : null;

  return {
    match: m,
    analytics: {
      winner,
      decidedInExtraTime: Boolean(m.afterExtraTime),
      totalGoals: total,
      margin,
      cleanSheet: m.homeScore === 0 || m.awayScore === 0,
      goalTimeline: (m.goals ?? []).slice().sort((x, y) => x.minute - y.minute),
      lateDrama: (m.goals ?? []).some((g) => g.minute >= 85),
    },
  };
}

export function tournamentStats() {
  const d = load();
  const scored = d.matches.filter((m) => m.homeScore !== null && m.awayScore !== null);
  const goals = scored.reduce((n, m) => n + (m.homeScore ?? 0) + (m.awayScore ?? 0), 0);
  const byStage: Record<string, number> = {};
  for (const m of scored) byStage[m.stage] = (byStage[m.stage] ?? 0) + 1;

  const performances = d.teams
    .map((t) => teamPerformance(t.id))
    .filter((p): p is TeamPerformance => p !== null && p.played > 0)
    .sort((a, b) => b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor);

  return {
    tournament: d.tournament,
    coverage: {
      matchesInDataset: d.matches.length,
      matchesWithScores: scored.length,
      matchesInTournament: d.tournament.matchCount,
      note: d.meta.coverage === "knockout"
        ? "Dataset currently covers the knockout phase. Run the refresh path to add the group stage."
        : "Full tournament coverage.",
    },
    goals: {
      total: goals,
      perMatch: scored.length ? Number((goals / scored.length).toFixed(2)) : 0,
    },
    matchesByStage: byStage,
    teamRankings: performances,
    generatedAt: d.meta.generatedAt,
  };
}
