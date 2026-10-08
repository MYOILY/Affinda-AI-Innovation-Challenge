import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { Requirement, Shift, Status, Volunteer, World, Zone } from "./types";

function readCsv(file: "volunteers.csv" | "zones.csv" | "shift_requirements.csv"): Record<string, string>[] {
  // Literal paths so Next's file tracer (and Vercel) ship the CSVs with the function.
  const text = fs.readFileSync(path.join(process.cwd(), "data", file), "utf-8");
  return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data;
}

const list = (s: string) => (s ? s.split(";").filter(Boolean) : []);

/**
 * The CSV records who truly did not arrive (status "no_show"). In the real world the
 * system only learns that when someone reports it, so by default we treat those people as
 * "on shift" until a report says otherwise. Pass `revealAbsences: true` to see ground truth.
 */
export function loadVolunteers(opts: { revealAbsences?: boolean } = {}): Volunteer[] {
  const vols = readCsv("volunteers.csv").map((r) => ({
    id: r.id,
    name: `${r.first_name} ${r.last_name}`,
    firstName: r.first_name,
    age: Number(r.age),
    phone: r.phone,
    experience: r.experience as Volunteer["experience"],
    pastEvents: Number(r.past_events),
    pastNoShows: Number(r.past_no_shows),
    languages: list(r.languages),
    certs: list(r.certifications),
    skills: list(r.skills),
    preferredRole: r.preferred_role,
    flexible: r.flexible_role === "yes",
    availSat: list(r.avail_sat) as Shift[],
    notes: r.availability_notes,
    satZone: r.sat_zone,
    satRole: r.sat_role,
    satShifts: list(r.sat_shifts) as Shift[],
    status: r.status_1405 as Status,
    currentZone: r.current_zone,
    minutesOnShift: Number(r.minutes_on_shift) || 0,
    minutesSinceBreak: r.minutes_since_break === "" ? null : Number(r.minutes_since_break),
    movedToday: 0,
    sunMin: Number(r.sun_min) || 0,
    remindedAtMin: 0,
    reliefDue: false,
    onSite: r.on_site === "yes",
    expectedStartMin: r.sat_shifts.split(";")[0] === "S2" ? 14 * 60 : null,
    checkInMin: r.s2_checkin ? hhmm(r.s2_checkin) : null,
  }));
  if (opts.revealAbsences) return vols;
  // Everyone starting at 2pm is "expected" until the clock shows they checked in.
  return vols.map((v) =>
    v.expectedStartMin !== null && (v.status === "on_shift" || v.status === "no_show")
      ? { ...v, status: "expected" as const, currentZone: "Off site", onSite: false, minutesOnShift: 0, minutesSinceBreak: null }
      : v,
  );
}

function hhmm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function loadWorld(): World {
  const zones: Zone[] = readCsv("zones.csv").map((r) => ({
    zone: r.zone,
    x: Number(r.x_m),
    y: Number(r.y_m),
    sunFactor: Number(r.sun_factor) || 0,
  }));
  const requirements: Requirement[] = readCsv("shift_requirements.csv").map((r) => ({
    shift: r.shift as Shift,
    zone: r.zone,
    role: r.role,
    headcount: Number(r.headcount),
    requiredCert: r.required_cert || null,
    minAge: Number(r.min_age),
  }));
  return { zones, requirements };
}
