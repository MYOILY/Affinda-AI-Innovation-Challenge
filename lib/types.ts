export type Shift = "S1" | "S2" | "S3";

export const SHIFTS: Shift[] = ["S1", "S2", "S3"];
export const SHIFT_TIMES: Record<Shift, string> = {
  S1: "10am-2pm",
  S2: "2pm-6pm",
  S3: "6pm-10pm",
};
export const SHIFT_START: Record<Shift, string> = { S1: "10am", S2: "2pm", S3: "6pm" };

/** The moment the demo is frozen at. */
export const NOW_SHIFT: Shift = "S2";
export const NOW_LABEL = "Sat 2:05pm";
export const NOW_TEMP_C = 38;

export type Status =
  | "on_shift"
  | "on_break"
  | "no_show"
  | "upcoming"
  | "finished"
  | "standby"
  | "unavailable"
  | "en_route"
  /** Sent to rest because of heat. Out for the current shift only. */
  | "heat_out"
  /** Rostered to start, shift has begun, but has not checked in yet. */
  | "expected";

export interface Volunteer {
  id: string;
  name: string;
  firstName: string;
  age: number;
  phone: string;
  experience: "returning" | "first_timer";
  pastEvents: number;
  pastNoShows: number;
  languages: string[];
  certs: string[];
  skills: string[];
  preferredRole: string;
  flexible: boolean;
  availSat: Shift[];
  notes: string;
  satZone: string;
  satRole: string;
  satShifts: Shift[];
  status: Status;
  currentZone: string;
  minutesOnShift: number;
  minutesSinceBreak: number | null;
  movedToday: number;
  /** Minutes in direct sun since the last break (the `sun_min` field in the volunteer log). */
  sunMin: number;
  /** Sun minutes at the moment of their last radio reminder (0 = never). The next one is due 90 min later. */
  remindedAtMin: number;
  /** Mina has recommended relief (2h 30m or more in the sun) and is waiting for Mo to approve. */
  reliefDue: boolean;
  /** Physically at the festival right now (working, on break, or idle at the hub). */
  onSite: boolean;
  /** Minutes after midnight the volunteer is expected to start (only for people starting a shift). */
  expectedStartMin: number | null;
  /** Minutes after midnight they will check in. null = they never do. */
  checkInMin: number | null;
}

export interface Requirement {
  shift: Shift;
  zone: string;
  role: string;
  headcount: number;
  requiredCert: string | null;
  minAge: number;
}

export interface Zone {
  zone: string;
  x: number;
  y: number;
  /** Share of each minute spent in direct sun here: 0 = fully shaded, 1 = fully exposed. */
  sunFactor: number;
}

export interface World {
  zones: Zone[];
  requirements: Requirement[];
}

export type Strategy = "fast" | "steady";

export interface Seat {
  id: string;
  zone: string;
  role: string;
  shifts: Shift[];
  urgent: boolean;
  /** Names of people who did not show. */
  because: string[];
  /** Names of people sent to rest in the heat. */
  becauseHeat: string[];
}

export interface Candidate {
  volunteerId: string;
  name: string;
  source: "standby" | "onsite";
  fromZone: string;
  etaMin: number;
  covers: Shift[];
  score: number;
  why: string[];
  cautions: string[];
}

export interface Move {
  id: string;
  seatId: string;
  kind: "cover" | "backfill";
  /** For backfills: the volunteer whose post this refills. */
  refillsFor?: string;
  volunteerId: string;
  name: string;
  source: "standby" | "onsite";
  fromZone: string;
  toZone: string;
  role: string;
  shifts: Shift[];
  etaMin: number;
  why: string[];
  cautions: string[];
  alternates: Candidate[];
  message: string;
}

export interface OpenSeat {
  zone: string;
  role: string;
  shifts: Shift[];
  reason: string;
}

export interface SearchStats {
  /** People physically at the event who were considered. */
  onSitePool: number;
  seats: number;
  /** Distinct volunteers eligible for at least one open seat. */
  eligible: number;
  /** Combinations (who covers, who refills) in the search space. */
  options: number;
  nodes: number;
  pruned: number;
  /** True if the whole space was searched, so the plan is provably the lowest cost. */
  complete: boolean;
  /** Lowest-cost plan found, lower is better. */
  bestCost: number;
}

export interface Plan {
  strategy: Strategy;
  seats: Seat[];
  moves: Move[];
  open: OpenSeat[];
  search: SearchStats;
  /** Minutes until the most urgent seat is covered. */
  coverEtaMin: number;
  signature: string;
}

export interface Notification {
  volunteerId: string;
  name: string;
  phone: string;
  message: string;
}
