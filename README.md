# Crewline: Riverside Ground Control

A phone-first recovery tool for Mo, the Riverside safety lead. Messy reports in, one move out, Mo signs off. The AI assistant is called Sharon.

```bash
npm install
npm run dev -- -H 127.0.0.1     # http://127.0.0.1:3000, open it at phone width
cp .env.example .env.local      # optional keys, the demo works without them
```

## What is in it

| Part | What it does | Where |
| --- | --- | --- |
| Radio intake | Typed, spoken or recorded walkie audio becomes text (ElevenLabs), then is read twice: for roster changes and as an incident | `app/api/transcribe`, `app/api/report`, `app/api/incident` |
| Incident handling | Urgency, place, "do now" action. Duplicate calls merge. Medical calls offer the nearest idle first-aider | `lib/incident.ts` |
| Roster recovery | When someone is missing 10 minutes, a CSP search over people already on site proposes who to send and why | `lib/roster.ts`, `lib/csp.ts`, `lib/clock.ts` |
| Heat-Aware Monitor | Sun time per volunteer (`sun_min`); every 1h 30m in the sun Sharon sends an automatic radio reminder to their earpiece (drink water, find shade); at 2h 30m she recommends a relief for approval | `lib/heat.ts`, `app/api/radio` |

Sharon is the AI assistant. Every safety decision stays with Mo, the human safety lead: nothing is messaged or moved until she taps.

## Demo order (about 3 minutes)

On a laptop the injects sit **beside** the phone, not in it — Mo's screen is only the decision. On a real phone they fold under *Inject a call*. Use them in this order.

1. **Radio: heat exhaustion**. A real recorded walkie call (`public/radio/`) plays out loud and is transcribed live (needs `ELEVENLABS_API_KEY`; without one the saved transcript in `lib/radio-calls.ts` is used and the strip says so). It becomes a HIGH medical incident. Tap *Send Vivian*.
2. **Radio: intruder at fence**. CRITICAL security incident: *Call 000*, and nobody is sent to confront them.
3. **Heat check**. Clock jumps to 2:11pm so it never hits the 2:10 medical no-show. Time then runs fast: Marcus gets the first 1h 30m radio reminder, Chloe the second, then at 3:07pm Marcus reaches 2h 30m. Tap *Approve* and he is released by radio ("You can take a break…"). Extra reminders stay silent so the demo is those two plus the one relieved call.
4. **Medical: two haven't shown**. From 2:05pm, time runs to 2:10pm (heat off). Finn Nguyen and Uma Martin are already 5 min late; at 10 minutes Sharon flags them as no-shows, the alert pops (Medical Tent short 2) and she drafts a plan. Tap *Approve*. If the clock is already past 2:10pm (after heat check), the same story is injected as a radio report.
5. **Pile-up: 6 calls**. After you approve the medical plan, this chip unlocks and the clock jumps to 2:12pm. Six overlapping walkie scraps land in a few seconds: Gate A crowd (called twice, the second raises it to a crush), a lost child at Food Court, a person down at Lawn Stage (called twice), and a fight at the bar. Duplicates merge; the four distinct incidents all stay on the log so nothing is missed.

## Checks

```bash
npx tsc --noEmit
for s in check-csp check-engine check-report check-heat check-incident; do npx tsx scripts/$s.ts; done
```

`data/*.csv` is synthetic (`npm run data`). Regenerating keeps the hand-edited `sun_min` column.
