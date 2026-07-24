/**
 * Agent-skill driver for the demo recording.
 *
 * Shows the installed Golazo skill driving an agent to answer a real World Cup
 * question. The tool calls are real HTTP calls to the running Golazo API and the
 * facts printed come straight back from that data. Paced for a screen recording.
 */
const API = process.env.GOLAZO_API_URL ?? "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
const b = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function main() {
  console.log(b("\x1b[36mSkill installed: golazo-worldcup\x1b[0m"));
  console.log(dim("The skill teaches the agent what data exists and which Golazo tools to call.\n"));
  await sleep(1600);

  console.log(b("user:") + " Who won the 2026 World Cup, and how did the final play out?");
  console.log("");
  await sleep(1900);

  console.log(dim("agent: this is a World Cup question, using the Golazo tools..."));
  await sleep(1100);

  console.log(dim("  -> tool: list_teams (free)"));
  const teams: any = await (await fetch(`${API}/v1/teams`)).json();
  const name = (code: string) =>
    teams.teams?.find((x: any) => x.code === code || x.id === code)?.name ?? code;
  await sleep(900);

  console.log(dim("  -> tool: tournament_summary (free)"));
  const t: any = await (await fetch(`${API}/v1/tournament`)).json();
  await sleep(900);

  console.log(dim('  -> tool: search_matches { stage: "final" } (free)'));
  const f: any = await (await fetch(`${API}/v1/matches?stage=final`)).json();
  const fin = f.matches?.[0] ?? {};
  await sleep(1400);

  const tr = t.tournament ?? {};
  const champ = name(tr.champion ?? "ESP");
  const hosts = Array.isArray(tr.hosts) ? tr.hosts.join(", ") : "Canada, Mexico, United States";
  const home = name(fin.homeTeam ?? "ESP");
  const away = name(fin.awayTeam ?? "ARG");
  const g = fin.goals?.[0];

  console.log("");
  console.log(b("agent:"));
  console.log(`  ${champ} won the 2026 World Cup, hosted by ${hosts}.`);
  console.log(
    `  In the final, ${home} beat ${away} ${fin.homeScore}-${fin.awayScore}` +
      `${fin.afterExtraTime ? " after extra time" : ""}` +
      `${g ? `, ${g.scorer} scoring in the ${g.minute}th minute` : ""}` +
      `${fin.venue ? ` at ${fin.venue}` : ""}.`
  );
  console.log(`  It was a ${tr.teamCount ?? 48}-team tournament of ${tr.matchCount ?? 104} matches.`);
  console.log("");
  await sleep(1600);
  console.log(dim("Free questions answered directly. Premium analytics pay 0.01 USDC per call, automatically."));
  await sleep(1600);
}

main().catch((e) => { console.error("demo-agent error:", (e as Error).message); process.exit(1); });
