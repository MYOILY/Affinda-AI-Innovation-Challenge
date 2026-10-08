# Crewline

A phone-first recovery tool for **Mo**, the Riverside festival safety lead. Messy walkie reports come in; Sharon (the AI assistant) reads them, drafts one move, and waits. Nothing is messaged or moved until Mo signs off.

Built for the Affinda AI Innovation Challenge, Track 3 — Riverside Ground Control.

---

## Try it (about 3 minutes)

**Open:** [https://crewline-nine.vercel.app](https://crewline-nine.vercel.app)

No login, no install. Use a **wide laptop window** so Mo’s phone is on the left and the injects (*What Mo hears*) sit **beside** the glass. On a phone, the same chips fold under **Inject a call** at the bottom.

1. Tap the title card (**Tap to open**). That unlocks sound.
2. Confirm **Sound on** in the top bar.
3. Use the chips **in this order**. After each radio or plan, tap the action on the phone (Send / Approve) before the next chip.

| # | Chip (beside the phone) | Then on the phone | What you should see |
| --- | --- | --- | --- |
| 1 | **heat exhaustion** | **Send Vivian** | A walkie call plays. Sharon reads it as HIGH medical at Main Stage and offers the nearest idle first-aider. |
| 2 | **intruder at fence** | Read the card — do **not** send anyone | CRITICAL security. Action is *Call 000*. Volunteers stay clear. |
| 3 | **Heat check** | Wait for the cards, then **Approve** Marcus | Clock jumps to 2:11pm (past the medical window). Time runs fast: Marcus gets a 1h 30m radio reminder, Chloe the second, then at 3:07pm Marcus hits 2h 30m. Approve releases him (“You can take a break…”). |
| 4 | **Medical: two haven't shown** | **Approve** the plan | If you skipped heat, time runs 2:05 → 2:10 and Finn + Uma flag as no-shows. After heat, the same story arrives as a radio. Medical Tent is short 2; Sharon drafts who to send. Mo signs off. |
| 5 | **Pile-up: 6 calls** | Watch the log | Unlocks only after medical Approve. Clock to 2:12pm. Six scraps land: Gate A crowd (twice — the second raises it to a crush), lost child at Food Court, person down at Lawn Stage (twice), fight at the bar. Duplicates merge; four incidents stay on the log. |

**Reset to 2:05pm** (last chip) starts over.

Sharon **reads, drafts, and reminds**. Mo **decides**. After medical Approve, Vivian is gone — that is honest. Pile-up stays grey until that Approve so the medical card is not buried.

---

## The problem

Saturday, 2:05pm, 38°C. Shift 2 has just started. Radios are noisy, two first-aiders have not checked in, people are cooking in the sun, and six calls can land in the same minute.

Mo cannot read a spreadsheet on the lawn. She needs:

1. What just happened, in one line.
2. One recommended move, with why.
3. A tap to approve — or she keeps control and does something else.

---

## What Sharon does (and does not)

| Sharon may | Sharon may not |
| --- | --- |
| Transcribe walkie audio | Message a volunteer |
| Classify a call (urgency, place, “do now”) | Lower an urgency the rules already set |
| Merge duplicate calls about the same thing | Change who is sent, or invent a person |
| Search the on-site roster and propose a cover | Pull someone off First Aid or Lost Children to fill another gap |
| Word a radio reminder or an SMS | Release someone from the heat without Approve |
| Flag a 10-minute no-show or 2h 30m in the sun | Act on a pile-up until the medical plan is signed off |

Rules always run first. With `OPENAI_API_KEY` a model can improve wording and matching; `mergeAi()` and the planner discard anything that would weaken a call or swap people. Without a key (including this hosted demo), the same path runs on the rules floor and saved walkie transcripts.

---

## How it works

| Part | What it does | Where |
| --- | --- | --- |
| Start card | Title on the phone. Tap opens Crewline and unlocks audio. | `components/StartScreen.tsx`, `public/start-page.png` |
| Radio intake | Typed, spoken, or recorded walkie audio → text (ElevenLabs `scribe_v1`), then read twice: roster change and incident. | `app/api/transcribe`, `app/api/report`, `app/api/incident` |
| Incident handling | Urgency, place, action. Same-place calls within 15 minutes merge; a second call can raise urgency (queue → crush). Medical offers the nearest idle first-aider. | `lib/incident.ts` |
| Roster recovery | At 10 minutes late, a CSP search over people already on site proposes who to send and why. | `lib/roster.ts`, `lib/csp.ts`, `lib/clock.ts` |
| Heat watch | Each zone has a sun factor. Every 1h 30m in the sun Sharon radios a reminder (water, shade). At 2h 30m she recommends relief; Mo approves. | `lib/heat.ts`, `app/api/radio` |
| Wording | SMS and earpiece copy open as Sharon. Templates are the fallback; a model is used only if it passes safety checks. | `app/api/narrate`, `app/api/radio` |

The phone UI lives in `components/Crewline.tsx`. On a laptop, `PhoneShell` draws an iPhone 18 Pro bezel and portals the inject chips into a desk rail so they never sit on Mo’s glass.

---

## Run locally

```bash
npm install
cp .env.example .env.local      # optional keys; the demo runs without them
npm run dev -- -H 127.0.0.1     # http://127.0.0.1:3000
```

There is no `requirements.txt`. Runtime deps are npm (`package.json`). The only Python in the repo is `scripts/generate_data.py`, which uses the standard library.

---

## Architecture

```
app/
  page.tsx                 Phone shell → start card → Crewline
  api/transcribe           Walkie audio → text (ElevenLabs)
  api/report               Messy text → roster events (no_show / heat_out)
  api/incident             One call → urgency, category, zone, action
  api/radio                Heat reminder / relief wording
  api/narrate              Plan summary + volunteer SMS
components/
  PhoneShell.tsx           Bezel + desk rail for injects
  StartScreen.tsx          Title card
  Crewline.tsx             Live UI, clock, chips, cards
lib/
  data.ts                  Load data/*.csv
  clock.ts                 Demo clock, 10-min late rule, sun accrual
  report.ts                Rules reader for roster names
  incident.ts              Rules classifier + 15-min merge
  roster.ts                Coverage, candidates, plan
  csp.ts                   All-different search, cheapest complete plan
  heat.ts                  Sun watch, radio scripts
  radio-calls.ts           Recorded demo clips + fallback transcripts
data/
  volunteers.csv           300 synthetic volunteers, live status at 14:05
  shift_requirements.csv   Saturday headcount by zone / role / shift
  zones.csv                Metres on the riverfront + sun_factor
```

**Clock.** Demo opens at 2:05pm. Medical no-show fires at 2:10. Heat check starts at 2:11 (`skipNoShow`). Pile-up at 2:12 after Approve. Simulated minutes tick at 420ms so a 3-minute recording can cover hours of sun time.

**Planner.** Open seats become CSP variables. Each option is a legal person (certs, age, on site, not safety-critical) or “leave open” at a heavy cost. Search is depth-first with most-constrained-variable order and branch-and-bound. When it finishes, the cost is the proven minimum.

**Merge.** Same category + same zone + within 15 minutes → one incident. A later call can raise urgency (crowd pushing → crush) but never drop it.

---

## Data

`data/*.csv` is synthetic and already in the repo (`npm run data` / `python3 scripts/generate_data.py`). Regenerating is seeded and keeps the hand-edited `sun_min` column so the heat demo stays timed.

Baked into Saturday 14:05:

- Finn Nguyen and Uma Martin are the two Medical Tent S2 no-shows (treated as still expected until the 10-minute rule or a report).
- Other first-aid certified people are on site in other zones, plus one idle first-aider at the hub, so the search has a real trade-off.
- Marcus at Gate B is close to the first heat reminder.

No pip packages are required to regenerate.

---

## Environment

Copy `.env.example` to `.env.local`. Every key is optional.

| Variable | Used for | Without it |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | Live speech-to-text on recorded / uploaded walkie audio | Saved transcripts; the strip says so |
| `OPENAI_API_KEY` | Report matching, incident wording, SMS, radio copy | Rules + templates |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini` | — |

Keys stay on the server. Never commit `.env.local`.

---

## Checks

```bash
npx tsc --noEmit
for s in check-csp check-engine check-report check-heat check-incident; do npx tsx scripts/$s.ts; done
```

| Script | Asserts |
| --- | --- |
| `check-csp` | Solver cost matches brute-force on 500 random problems; no double-booking |
| `check-engine` | 2:10 no-show → plan → approve closes the Medical Tent gap |
| `check-report` | Noisy radio lines map to the right roster ids |
| `check-heat` | Reminders at 90 min sun, relief at 150, no extra chatter |
| `check-incident` | Rules floor + merge + recorded walkie transcripts |

```bash
npm run build     # production bundle
```

---

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4
- Zod, PapaParse
- Optional: ElevenLabs Scribe, OpenAI Chat Completions
- Node 20+ recommended. Python 3 only if you regenerate CSVs.
