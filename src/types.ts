// Golazo data schema for the FIFA World Cup 2026 archive.
// The tournament concluded on 19 July 2026, so this dataset is a fixed
// historical record rather than a live feed.

export type Stage =
  | "group"
  | "round_of_32"
  | "round_of_16"
  | "quarter_final"
  | "semi_final"
  | "third_place"
  | "final";

/** Where a record came from, so consumers can judge confidence. */
export type Provenance = "verified" | "imported";

export interface Team {
  id: string;
  name: string;
  code: string;
  confederation?: string;
  group?: string;
}

export interface Goal {
  team: string;
  scorer: string;
  minute: number;
  penalty?: boolean;
}

export interface Match {
  id: string;
  stage: Stage;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  afterExtraTime?: boolean;
  venue?: string;
  goals?: Goal[];
  provenance: Provenance;
}

export interface Group {
  name: string;
  teams: string[];
}

export interface Tournament {
  id: string;
  name: string;
  edition: number;
  year: number;
  hosts: string[];
  startDate: string;
  endDate: string;
  teamCount: number;
  groupCount: number;
  matchCount: number;
  champion: string | null;
  runnerUp: string | null;
  thirdPlace: string | null;
  fourthPlace: string | null;
}

export interface Dataset {
  tournament: Tournament;
  groups: Group[];
  teams: Team[];
  matches: Match[];
  meta: {
    generatedAt: string;
    source: string;
    coverage: string;
    notes: string[];
  };
}
