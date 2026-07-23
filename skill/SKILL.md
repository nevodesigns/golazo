---
name: golazo-worldcup
description: >
  Query the complete FIFA World Cup 2026 archive (matches, scores, teams,
  groups, knockout bracket) through the Golazo MCP tools. Use when a user asks
  anything about the 2026 World Cup: results, standings, how a team performed,
  head to head comparisons, the final, the bracket, or tournament statistics.
  Free tools cover the basic archive. Premium tools cost 0.01 USDC per call and
  are paid automatically through x402 on Injective when a wallet is configured.
license: MIT
metadata:
  version: "0.1.0"
  author: nevodesigns
---

# Golazo, World Cup 2026 data

Golazo serves the finished FIFA World Cup 2026 as a permanent archive. The
tournament ran 11 June to 19 July 2026, hosted by Canada, Mexico, and the United
States: 48 teams, 12 groups, 104 matches. Spain won, beating Argentina 1-0 after
extra time in the final.

This skill drives the Golazo MCP tools. Install the Golazo MCP server first (see
its README), then this skill teaches you when and how to use each tool.

## What data is available

- Tournament summary: hosts, dates, counts, final standings.
- Teams: all 48, each tagged with its group.
- Matches: every fixture with score, date, and stage. Stages are `group`,
  `round_of_32`, `round_of_16`, `quarter_final`, `semi_final`, `third_place`,
  `final`.
- Derived analytics: winner and margin per match, goal timelines on the marquee
  knockout games, team performance records, head to head, and full tournament
  stats.

Every match carries a `provenance` field. `verified` means the result was cross
checked by hand against public sources (the knockout marquee games carry goal
detail). `imported` means it came from the football-data.org feed.

## Tools, and what each costs

Free, use freely:

| Tool | Use it for |
|---|---|
| `tournament_summary` | Overview and final standings |
| `list_teams` | All teams and their groups |
| `search_matches` | Fixtures by `stage` or `team` (three letter code) |

Premium, 0.01 USDC per call, paid automatically when a wallet is set:

| Tool | Use it for |
|---|---|
| `match_analytics` | Deep read of one match, pass a match id |
| `head_to_head` | Record between two teams in this tournament |
| `team_breakdown` | One team's full performance record |
| `tournament_stats` | Goals per match, stage breakdown, team ranking |

## How payment works, and what to tell the user

Premium tools are gated behind an x402 micropayment. You do not do anything
special: call the tool as normal.

- If a wallet is configured on the MCP server, the payment is signed and settled
  automatically, and you get the data back. Do not ask the user to pay by hand.
- If no wallet is configured, the tool returns a short message saying the query
  is premium and how to enable payment. Relay that plainly. Do not retry in a
  loop, and do not treat it as a failure of the question.
- If the wallet is underfunded, the tool says so and how to top it up. Relay it.

Spend premium calls deliberately. Answer from the free tools when you can, and
reach for a premium tool only when the question actually needs the deeper data.

## Decision guide

- "Who won", "what was the score", "who was in group X", "list the
  quarter finals": free tools are enough. Use `search_matches` and
  `tournament_summary`.
- "How did Spain do across the tournament", "compare England and France",
  "which team had the best goal difference", "break down the final minute by
  minute": these need premium tools.

## Worked examples

### Analyse the final

1. `search_matches` with `stage: "final"` to get the match and its id.
2. `match_analytics` with that id for the goal timeline and extra time detail.

You will see Spain 1-0 Argentina, decided in extra time, Ferran Torres scoring
in the 106th minute at MetLife Stadium. Report the winner, the margin, the
scorer and minute, and that it went to extra time.

### Compare two teams

For "who had the better run, Spain or Argentina":

1. `head_to_head` with `teamA: "ESP"`, `teamB: "ARG"` for their direct meeting
   (the final).
2. `team_breakdown` for each of `ESP` and `ARG` to compare their whole
   tournaments: matches won, goals for and against, clean sheets, stages
   reached.

Read the head to head for the decisive match, then use the breakdowns to say who
was more dominant across the whole run, not just in the one game.

### Find the highest scoring match

1. `tournament_stats` for the stage breakdown and team ranking.
2. If you need the single highest scoring game, `search_matches` across stages
   and compare totals. The third place playoff, England 6-4 France, was a ten
   goal game and a strong candidate.

## Reading the results

- Scores are `homeScore`-`awayScore`. Home and away in a neutral venue knockout
  are bracket positions, not venue advantage, so do not over read them.
- `afterExtraTime: true` means the match was decided in extra time. Say so.
- A head to head with `meetings: 0` means the teams did not play each other in
  this tournament. State that rather than implying a result.
- Team codes are three letters: ESP Spain, ARG Argentina, ENG England, FRA
  France, and so on. `list_teams` has the full mapping.
