/**
 * Golazo MCP server.
 *
 * Exposes the World Cup 2026 archive to any MCP capable agent. Free tools read
 * open data. Premium tools call the paywalled endpoints and, when a wallet is
 * configured, settle the x402 micropayment automatically via pay.ts, so the
 * agent buys the data on its own. When no wallet is set, premium tools return a
 * clear "payment required, here is how to configure it" message, never a raw
 * error.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiGet, type PayResult } from "./pay.js";

const server = new McpServer({ name: "golazo", version: "0.1.0" });

/** Render a PayResult as MCP tool content, including the friendly 402 path. */
function present(result: PayResult, label: string) {
  if (result.paymentNeeded) {
    const p = result.paymentNeeded;
    return {
      content: [
        {
          type: "text" as const,
          text:
            `${label} is a premium query (${p.price} per call on ${p.network}).\n\n` +
            `${p.message}\n\n${p.howTo}`,
        },
      ],
    };
  }
  if (!result.ok) {
    const detail =
      result.error ??
      (result.data && typeof result.data === "object"
        ? JSON.stringify(result.data)
        : `HTTP ${result.status}`);
    return {
      content: [{ type: "text" as const, text: `${label} failed: ${detail}` }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
  };
}

/* ------------------------------- free ------------------------------- */

server.registerTool(
  "tournament_summary",
  {
    title: "Tournament summary",
    description:
      "World Cup 2026 overview: hosts, dates, team and match counts, and the final standings (champion, runner up, third, fourth). Free.",
    inputSchema: {},
  },
  async () => present(await apiGet("/v1/tournament"), "tournament_summary")
);

server.registerTool(
  "list_teams",
  {
    title: "List teams",
    description: "All 48 teams in the tournament, with their group. Free.",
    inputSchema: {},
  },
  async () => present(await apiGet("/v1/teams"), "list_teams")
);

server.registerTool(
  "search_matches",
  {
    title: "Search matches",
    description:
      "Matches, optionally filtered by stage (group, round_of_32, round_of_16, quarter_final, semi_final, third_place, final) or by team code (for example ESP, ARG, ENG). Free.",
    inputSchema: {
      stage: z
        .enum([
          "group", "round_of_32", "round_of_16",
          "quarter_final", "semi_final", "third_place", "final",
        ])
        .optional(),
      team: z.string().optional().describe("Three letter team code, for example ESP"),
    },
  },
  async ({ stage, team }) => {
    const params = new URLSearchParams();
    if (stage) params.set("stage", stage);
    if (team) params.set("team", team);
    const q = params.toString() ? `?${params.toString()}` : "";
    return present(await apiGet(`/v1/matches${q}`), "search_matches");
  }
);

/* ------------------------------ premium ----------------------------- */

server.registerTool(
  "match_analytics",
  {
    title: "Match analytics (premium)",
    description:
      "Detailed analytics for a single match: winner, margin, goal timeline, extra time, late drama. Costs 0.01 USDC. Pass a match id from search_matches.",
    inputSchema: { matchId: z.string().describe("Match id, for example wc2026-final-esp-arg-2026-07-19") },
  },
  async ({ matchId }) =>
    present(await apiGet(`/v1/premium/match/${encodeURIComponent(matchId)}`), "match_analytics")
);

server.registerTool(
  "head_to_head",
  {
    title: "Head to head (premium)",
    description:
      "Head to head record between two teams across this tournament: meetings, wins, goals, and the matches. Costs 0.01 USDC.",
    inputSchema: {
      teamA: z.string().describe("Team code, for example ESP"),
      teamB: z.string().describe("Team code, for example ARG"),
    },
  },
  async ({ teamA, teamB }) =>
    present(
      await apiGet(`/v1/premium/h2h/${encodeURIComponent(teamA)}/${encodeURIComponent(teamB)}`),
      "head_to_head"
    )
);

server.registerTool(
  "team_breakdown",
  {
    title: "Team performance breakdown (premium)",
    description:
      "Full performance record for one team: played, won, drawn, lost, goals for and against, clean sheets, biggest win, stages reached. Costs 0.01 USDC.",
    inputSchema: { team: z.string().describe("Team code, for example ESP") },
  },
  async ({ team }) =>
    present(await apiGet(`/v1/premium/team/${encodeURIComponent(team)}`), "team_breakdown")
);

server.registerTool(
  "tournament_stats",
  {
    title: "Tournament stats export (premium)",
    description:
      "Complete tournament statistics: goals per match, matches by stage, and a full team ranking by goal difference. Costs 0.01 USDC.",
    inputSchema: {},
  },
  async () => present(await apiGet("/v1/premium/stats"), "tournament_stats")
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only, so stdout stays clean for the MCP protocol.
  console.error("golazo mcp server ready on stdio");
}

main().catch((err) => {
  console.error(`golazo mcp fatal: ${err.message}`);
  process.exit(1);
});
