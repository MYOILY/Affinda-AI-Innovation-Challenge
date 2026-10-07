#!/usr/bin/env python3
"""Generate synthetic Riverside roster data (seeded, so output is reproducible).

Outputs (in ./data):
  volunteers.csv         300 volunteers: skills, certs, availability, Saturday roster, live status at 14:05
  shift_requirements.csv Saturday headcount needed per zone/role/shift
  zones.csv              Site zones with coordinates (metres along the riverfront)

Scenario baked in: Saturday 14:05, 38C. Two first-aiders did not show for the
Medical Tent S2 shift. Other first-aid certified volunteers exist elsewhere on site
and on standby, so there is a real recovery decision to make.

Run: python3 scripts/generate_data.py [--seed 42]
"""
import argparse
import csv
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data"

SHIFTS = {"S1": "10:00-14:00", "S2": "14:00-18:00", "S3": "18:00-22:00"}
SHIFT_ORDER = ["S1", "S2", "S3"]
DAYS = ["fri", "sat", "sun"]

FIRST = [
    "Aiden", "Amara", "Ananya", "Archie", "Ava", "Ben", "Bella", "Callum", "Charlotte", "Chloe",
    "Daniel", "Dev", "Eleni", "Ella", "Ethan", "Fatima", "Finn", "Grace", "Hamish", "Hana",
    "Harper", "Henry", "Imogen", "Isla", "Ivy", "Jack", "Jasmine", "Jin", "Kai", "Kavya",
    "Layla", "Leo", "Lucas", "Lucy", "Mai", "Marcus", "Maya", "Mei", "Mia", "Mohammed",
    "Nadia", "Noah", "Olivia", "Oscar", "Pia", "Priya", "Rafael", "Riley", "Rohan", "Ruby",
    "Sam", "Sana", "Sienna", "Sofia", "Tane", "Thomas", "Tom", "Tran", "Uma", "Vivian",
    "Will", "Yara", "Zac", "Zara", "Zoe", "Aroha", "Nguyen", "Hugo", "Elise", "Jayden",
    "Anika", "Liam", "Matilda", "Omar", "Penny", "Quinn", "Reece", "Shreya", "Tia", "Yuki",
]
LAST = [
    "Anderson", "Bennett", "Brown", "Chen", "Clarke", "Collins", "Cooper", "Dang", "Davies", "Dimitriou",
    "Edwards", "Evans", "Farah", "Fernandez", "Fraser", "Gill", "Gupta", "Hall", "Harris", "Hughes",
    "Ibrahim", "Jackson", "Jones", "Kang", "Kaur", "Kelly", "Khan", "Kim", "Lee", "Lewis",
    "Li", "Lopez", "Martin", "Mitchell", "Moore", "Morgan", "Murphy", "Nair", "Nguyen", "O'Brien",
    "Park", "Patel", "Phillips", "Pham", "Reid", "Roberts", "Rossi", "Santos", "Sharma", "Singh",
    "Smith", "Stewart", "Tan", "Taylor", "Thompson", "Tran", "Turner", "Walker", "Wang", "Watson",
    "White", "Williams", "Wilson", "Wong", "Wright", "Yang", "Young", "Zhang", "Zhou", "Papadopoulos",
]
LANGUAGES = ["Mandarin", "Cantonese", "Vietnamese", "Hindi", "Punjabi", "Arabic", "Greek", "Italian", "Spanish", "Auslan", "Indonesian", "Korean"]

# zone, x (metres along riverfront), y (metres back from the river)
ZONES = [
    ("Medical Tent", 450, 60),
    ("Water Station", 420, 90),
    ("Main Stage", 700, 150),
    ("Lawn Stage", 250, 160),
    ("Gate A", 0, 220),
    ("Gate B", 900, 220),
    ("Riverbank", 480, 10),
    ("Food Court", 560, 120),
    ("Bar Zone", 650, 100),
    ("Info Hub", 300, 200),
    ("Lost Children Point", 480, 200),
    ("Volunteer Hub", 350, 230),
    ("Break Area", 380, 240),
]

# Share of each minute spent in direct sun. Used by the heat monitor to accrue `sun_min` as the
# demo clock runs. Matches the pattern in the volunteer log: open gates and stages ~1, partly
# covered ~0.4, canopies ~0.2-0.3, tents 0.
SUN_FACTOR = {
    "Gate A": 1.0, "Gate B": 1.0, "Main Stage": 0.8, "Lawn Stage": 0.8,
    "Water Station": 0.4, "Riverbank": 0.4, "Food Court": 0.3, "Bar Zone": 0.2,
    "Medical Tent": 0.0, "Info Hub": 0.0, "Lost Children Point": 0.0, "Volunteer Hub": 0.0, "Break Area": 0.0,
}

# role -> (required cert or None, minimum age)
ROLES = {
    "First Aid": ("first_aid", 18),
    "Water Station": (None, 16),
    "Crowd Steward": (None, 18),
    "Gate Entry": (None, 18),
    "Info Desk": (None, 16),
    "Lost Children": ("wwcc", 18),
    "Food Court Support": (None, 16),
    "Bar Support": ("rsa", 18),
    "Stage Crew": (None, 18),
}

# zone, role, (S1, S2, S3) headcount on Saturday
REQUIREMENTS = [
    ("Medical Tent", "First Aid", (6, 8, 8)),
    ("Water Station", "Water Station", (6, 10, 8)),
    ("Lawn Stage", "Crowd Steward", (4, 6, 10)),
    ("Main Stage", "Crowd Steward", (4, 6, 10)),
    ("Main Stage", "Stage Crew", (3, 3, 4)),
    ("Gate A", "Gate Entry", (8, 6, 4)),
    ("Gate B", "Gate Entry", (6, 5, 4)),
    ("Riverbank", "Crowd Steward", (3, 5, 6)),
    ("Info Hub", "Info Desk", (3, 4, 4)),
    ("Lost Children Point", "Lost Children", (2, 3, 3)),
    ("Food Court", "Food Court Support", (4, 6, 6)),
    ("Bar Zone", "Bar Support", (0, 4, 6)),
]

SKILLS = [
    "customer_service", "crowd_management", "radio_comms", "heavy_lifting", "event_setup",
    "de_escalation", "hospitality", "first_responder_experience", "navigation_wayfinding",
]
PREFERRED = ["First Aid", "Water Station", "Crowd Steward", "Gate Entry", "Info Desk", "Food Court Support", "Stage Crew", "Any"]

AVAIL_PATTERNS = [
    ("S1;S2;S3", 0.34), ("S1;S2", 0.14), ("S2;S3", 0.20),
    ("S1", 0.10), ("S2", 0.10), ("S3", 0.12),
]
DAY_PRESENT = {"fri": 0.55, "sat": 0.88, "sun": 0.76}

NOTE_BY_PATTERN = {
    "S1;S2;S3": ["free all day", "available whenever you need me", "free from open to close"],
    "S1;S2": ["free until 6pm", "can do morning and afternoon", "need to leave by 6pm"],
    "S2;S3": ["free from 2pm", "uni commitment in the morning, free after lunch", "afternoon and evening only"],
    "S1": ["mornings only", "free until 2pm"],
    "S2": ["afternoon only", "only free 2 to 6"],
    "S3": ["evenings only", "free after 6pm", "work until 5, free after"],
}
DAY_LABEL = {"fri": "Friday", "sat": "Saturday", "sun": "Sunday"}
EXTRA_NOTES = [
    "prefers to be with a friend", "can't stand for very long", "no heavy lifting please",
    "has own car", "last train is 10:30pm", "first festival volunteer, a bit nervous",
    "happy to be moved anywhere", "would rather not work near loud stages", "on the Melbourne Uni volunteers team",
    "studying nursing", "doing paramedic science", "has done St John volunteering",
]


def weighted_choice(rng, pairs):
    r = rng.random() * sum(w for _, w in pairs)
    for item, w in pairs:
        r -= w
        if r <= 0:
            return item
    return pairs[-1][0]


def walk_minutes(a, b):
    za = {z[0]: z for z in ZONES}
    if a not in za or b not in za:
        return ""
    d = math.hypot(za[a][1] - za[b][1], za[a][2] - za[b][2])
    return max(1, round(d / 80))  # ~80 m/min, festival crowd pace


def make_volunteers(rng, n=300):
    vols = []
    used = set()
    for i in range(1, n + 1):
        while True:
            fn, ln = rng.choice(FIRST), rng.choice(LAST)
            if (fn, ln) not in used:
                used.add((fn, ln))
                break
        age = rng.choices([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 28, 32, 40, 55],
                          weights=[1, 2, 10, 14, 15, 14, 12, 9, 6, 4, 4, 3, 3, 2])[0]
        certs = []
        if rng.random() < 0.12 and age >= 18:
            certs.append("first_aid")
        if age >= 18 and rng.random() < 0.30:
            certs.append("rsa")
        if age >= 18 and rng.random() < 0.38:
            certs.append("wwcc")
        if rng.random() < 0.20:
            certs.append("food_safety")
        skills = rng.sample(SKILLS, rng.choice([1, 2, 2, 3]))
        if "first_aid" in certs and "first_responder_experience" not in skills and rng.random() < 0.6:
            skills.append("first_responder_experience")
        langs = ["English"]
        if rng.random() < 0.28:
            langs.append(rng.choice(LANGUAGES))
        past_events = rng.choices([0, 1, 2, 3, 5, 8], weights=[55, 18, 12, 8, 5, 2])[0]
        past_no_shows = 0 if past_events == 0 else min(past_events, rng.choices([0, 1, 2], weights=[85, 12, 3])[0])

        avail = {}
        for d in DAYS:
            avail[d] = weighted_choice(rng, AVAIL_PATTERNS) if rng.random() < DAY_PRESENT[d] else ""
        if not any(avail.values()):
            avail["sat"] = weighted_choice(rng, AVAIL_PATTERNS)

        parts = []
        present = [d for d in DAYS if avail[d]]
        if len(present) == 1:
            parts.append(f"only free {DAY_LABEL[present[0]]}, {rng.choice(NOTE_BY_PATTERN[avail[present[0]]])}")
        else:
            for d in present:
                parts.append(f"{DAY_LABEL[d][:3]} {rng.choice(NOTE_BY_PATTERN[avail[d]])}")
        if rng.random() < 0.35:
            parts.append(rng.choice(EXTRA_NOTES))
        notes = "; ".join(parts)

        pref = rng.choice(PREFERRED)
        if "first_aid" in certs and rng.random() < 0.55:
            pref = "First Aid"
        flexible = "yes" if (rng.random() < 0.7 or "happy to be moved anywhere" in notes) else "no"

        vols.append({
            "id": f"V{i:03d}",
            "first_name": fn, "last_name": ln, "age": age,
            "phone": f"04{rng.randint(10,99)} {rng.randint(100,999)} {rng.randint(100,999)}",
            "email": f"{fn.lower()}.{ln.lower().replace(chr(39), '')}{i}@example.com",
            "experience": "returning" if past_events > 0 else "first_timer",
            "past_events": past_events, "past_no_shows": past_no_shows,
            "languages": ";".join(langs),
            "certifications": ";".join(certs),
            "skills": ";".join(skills),
            "preferred_role": pref,
            "flexible_role": flexible,
            "avail_fri": avail["fri"], "avail_sat": avail["sat"], "avail_sun": avail["sun"],
            "availability_notes": notes,
            # filled in by assign_saturday
            "sat_zone": "", "sat_role": "", "sat_shifts": "",
            "status_1405": "", "current_zone": "", "minutes_on_shift": 0, "minutes_since_break": "",
        })
    return vols


def eligible(v, role):
    cert, min_age = ROLES[role]
    if v["age"] < min_age:
        return False
    if cert and cert not in v["certifications"].split(";"):
        return False
    return True


def assign_saturday(rng, vols):
    """Fill requirements scarce-first; volunteers get one zone and a contiguous block of at most 2 shifts."""
    assigned = {}  # id -> {"zone","role","shifts":[...]}
    gaps = []
    order = sorted(REQUIREMENTS, key=lambda r: 0 if ROLES[r[1]][0] else 1)
    # process shift by shift so extensions work; within a shift, scarce roles first
    for si, shift in enumerate(SHIFT_ORDER):
        for zone, role, counts in order:
            need = counts[si]
            have = 0
            # extend people already in this zone/role from the previous shift
            if si > 0:
                prev = SHIFT_ORDER[si - 1]
                for vid, a in assigned.items():
                    if have >= need:
                        break
                    v = next(x for x in vols if x["id"] == vid)
                    if (a["zone"] == zone and a["role"] == role and a["shifts"] == [prev]
                            and shift in v["avail_sat"].split(";") and rng.random() < 0.45):
                        a["shifts"].append(shift)
                        have += 1
            pool = [v for v in vols
                    if v["id"] not in assigned
                    and shift in v["avail_sat"].split(";")
                    and eligible(v, role)]
            rng.shuffle(pool)
            # prefer people who asked for this role, and returning volunteers for the scarce ones
            pool.sort(key=lambda v: (v["preferred_role"] != role, v["experience"] != "returning" and bool(ROLES[role][0])))
            for v in pool:
                if have >= need:
                    break
                # only start a new block if the person is available at the start shift
                assigned[v["id"]] = {"zone": zone, "role": role, "shifts": [shift]}
                have += 1
            if have < need:
                gaps.append((zone, role, shift, need - have))
    return assigned, gaps


def block_start_minutes(shifts):
    return {"S1": 10 * 60, "S2": 14 * 60, "S3": 18 * 60}[shifts[0]]


def set_live_status(rng, vols, assigned):
    """Snapshot at Saturday 14:05."""
    NOW = 14 * 60 + 5
    by_id = {v["id"]: v for v in vols}
    for v in vols:
        a = assigned.get(v["id"])
        if a:
            v["sat_zone"], v["sat_role"], v["sat_shifts"] = a["zone"], a["role"], ";".join(a["shifts"])
            start = block_start_minutes(a["shifts"])
            end = {"S1": 14 * 60, "S2": 18 * 60, "S3": 22 * 60}[a["shifts"][-1]]
            if end <= NOW:
                v["status_1405"], v["current_zone"] = "finished", "Off site"
            elif start > NOW:
                v["status_1405"], v["current_zone"] = "upcoming", "Off site"
            else:
                on_shift = NOW - start
                v["minutes_on_shift"] = on_shift
                v["minutes_since_break"] = min(on_shift, rng.randint(15, 210)) if on_shift > 30 else on_shift
                v["status_1405"], v["current_zone"] = "on_shift", a["zone"]
        else:
            if "S2" in v["avail_sat"].split(";"):
                v["status_1405"], v["current_zone"] = "standby", "Volunteer Hub"
            else:
                v["status_1405"], v["current_zone"] = "unavailable", "Off site"

    # heat: people 2+ hours past their last break go on break, small natural no-show rate for S2 starters
    for v in vols:
        if v["status_1405"] == "on_shift":
            if v["minutes_on_shift"] > 60 and int(v["minutes_since_break"]) > 150 and rng.random() < 0.55:
                v["status_1405"], v["current_zone"], v["minutes_since_break"] = "on_break", "Break Area", rng.randint(2, 12)
            # (no random no-shows: the demo's two no-shows are scripted below)

    # --- scripted demo moment: two Medical Tent S2 first-aiders are no-shows ---
    medical_s2_starters = [v for v in vols if v["sat_zone"] == "Medical Tent"
                           and v["sat_shifts"].split(";")[0] == "S2" and v["status_1405"] in ("on_shift", "no_show")]
    rng.shuffle(medical_s2_starters)
    for v in medical_s2_starters[:2]:
        v["status_1405"], v["current_zone"] = "no_show", "Unknown"
        v["minutes_since_break"] = ""
    # guarantee real options exist: first-aid certified volunteers working other zones + standby
    fa_elsewhere = [v for v in vols if "first_aid" in v["certifications"].split(";")
                    and v["status_1405"] == "on_shift" and v["sat_zone"] != "Medical Tent"]
    fa_standby = [v for v in vols if "first_aid" in v["certifications"].split(";") and v["status_1405"] == "standby"]
    # promote a few first-aiders into non-medical roles if the greedy fill left too few
    if len(fa_elsewhere) < 3:
        donors = [v for v in vols if "first_aid" in v["certifications"].split(";")
                  and v["status_1405"] == "on_shift" and v["sat_zone"] == "Medical Tent"
                  and v["sat_shifts"].split(";")[0] == "S1"]
        for v in donors[: 3 - len(fa_elsewhere)]:
            v["sat_zone"], v["sat_role"] = rng.choice([("Gate B", "Gate Entry"), ("Water Station", "Water Station"), ("Lawn Stage", "Crowd Steward")])
            v["current_zone"] = v["sat_zone"]
    return fa_elsewhere, fa_standby


def add_presence(seed, vols):
    """Who is physically at the event, and when 2pm starters checked in.

    Uses its own random stream so it never changes any other column.
      on_site     yes = at the festival right now (working, on break, or idle at the Volunteer Hub)
      s2_checkin  HH:MM check-in time for volunteers starting at 2pm; blank = has not arrived
    """
    rng = random.Random(seed + 1)
    fa_standby_forced = 0
    for v in vols:
        st = v["status_1405"]
        if st in ("on_shift", "on_break", "en_route"):
            on_site = True
        elif st == "standby":
            # a handful of idle volunteers wait at the hub; the rest are not at the event
            on_site = rng.random() < 0.45
            if "first_aid" in v["certifications"].split(";"):
                # Exactly one idle first-aider at the hub, so a no-show of two forces the search
                # to also consider pulling a first-aider off another post.
                on_site = fa_standby_forced < 1
                fa_standby_forced += 1
        else:
            on_site = False
        v["on_site"] = "yes" if on_site else "no"
        if st == "standby" and not on_site:
            v["current_zone"] = "Off site"

        starts_s2 = v["sat_shifts"].split(";")[0] == "S2" if v["sat_shifts"] else False
        if starts_s2 and st == "no_show":
            v["s2_checkin"] = ""
        elif starts_s2 and st in ("on_shift", "on_break"):
            v["s2_checkin"] = f"14:{rng.randint(0, 4):02d}"
        else:
            v["s2_checkin"] = ""


def keep_sun_min(path, vols):
    """`sun_min` = minutes each volunteer has spent in direct sun since their last break.

    This column is maintained in the volunteer log, so regenerating must never overwrite it.
    Existing values are carried over by volunteer id. Only if the column is missing do we derive
    a fallback from minutes_since_break and the zone's sun factor.
    """
    existing = {}
    if path.exists():
        with open(path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("sun_min") not in (None, ""):
                    existing[r["id"]] = r["sun_min"]
    for v in vols:
        if v["id"] in existing:
            v["sun_min"] = existing[v["id"]]
        elif v["status_1405"] == "on_shift" and v["minutes_since_break"] not in ("", None):
            v["sun_min"] = round(int(v["minutes_since_break"]) * SUN_FACTOR.get(v["current_zone"], 0.0))
        else:
            v["sun_min"] = 0


def write_csv(path, rows, fields):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    OUT.mkdir(exist_ok=True)

    vols = make_volunteers(rng)
    assigned, gaps = assign_saturday(rng, vols)
    set_live_status(rng, vols, assigned)
    add_presence(args.seed, vols)
    keep_sun_min(OUT / "volunteers.csv", vols)

    fields = list(vols[0].keys())
    write_csv(OUT / "volunteers.csv", vols, fields)

    req_rows = []
    for zone, role, counts in REQUIREMENTS:
        cert, min_age = ROLES[role]
        for si, shift in enumerate(SHIFT_ORDER):
            if counts[si]:
                req_rows.append({"day": "sat", "shift": shift, "shift_time": SHIFTS[shift], "zone": zone,
                                 "role": role, "headcount": counts[si],
                                 "required_cert": cert or "", "min_age": min_age})
    write_csv(OUT / "shift_requirements.csv", req_rows,
              ["day", "shift", "shift_time", "zone", "role", "headcount", "required_cert", "min_age"])

    zone_rows = [{"zone": z, "x_m": x, "y_m": y, "sun_factor": SUN_FACTOR[z]} for z, x, y in ZONES]
    write_csv(OUT / "zones.csv", zone_rows, ["zone", "x_m", "y_m", "sun_factor"])

    # --- report ---
    status = {}
    for v in vols:
        status[v["status_1405"]] = status.get(v["status_1405"], 0) + 1
    fa = [v for v in vols if "first_aid" in v["certifications"].split(";")]
    print(f"Wrote {len(vols)} volunteers -> {OUT/'volunteers.csv'}")
    print(f"Rostered Saturday: {len(assigned)}   Status at 14:05: {status}")
    print(f"First-aid certified: {len(fa)}")
    print(f"Unfilled Saturday slots: {sum(g[3] for g in gaps)}  {gaps[:6]}")
    ns = [f"{v['id']} {v['first_name']} {v['last_name']}" for v in vols if v["status_1405"] == "no_show"]
    print(f"No-shows at 14:05: {ns}")


if __name__ == "__main__":
    main()
