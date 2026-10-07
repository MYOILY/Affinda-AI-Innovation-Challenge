# Cover: Riverside Ground Control

A phone-first recovery tool for Mo, the safety lead. Messy reports in, one move out, Mo signs off.

```bash
npm install
npm run dev -- -H 127.0.0.1     # http://127.0.0.1:3000, open it at phone width
cp .env.example .env.local      # optional keys, the demo works without them
```

## What is in it

| Part | What it does | Where |
| --- | --- | --- |
| Radio intake | Typed, spoken or uploaded walkie audio becomes text (ElevenLabs), then is read twice: for roster changes and as an incident | `app/api/transcribe`, `app/api/report`, `app/api/incident` |
| Incident handling | Urgency, place, "do now" action. Duplicate calls merge. Medical calls offer the nearest idle first-aider | `lib/incident.ts` |
| Roster recovery | When someone is missing 10 minutes, a CSP search over people already on site proposes who to send and why | `lib/roster.ts`, `lib/csp.ts`, `lib/clock.ts` |
| Heat-Aware Monitor | Sun time per volunteer (`sun_min`); every 1h 30m in the sun Mina sends an automatic radio reminder to their earpiece (drink water, find shade); at 2h 30m she recommends a relief to Mo | `lib/heat.ts`, `app/api/radio` |

Every safety decision stays with Mo: nothing is messaged or moved until she taps.

## Demo order (about 3 minutes)

Use the chips above the input bar, in this order.

1. **Main Stage: person down** then **Main Stage: 2nd call**. One CRITICAL incident, calls merged. Tap *Send Vivian*.
2. **Wait until 2:10pm**. Two no-shows are noticed by Mina, the AI assistant. The plan re-searches without Vivian. Tap *Approve*.
3. **Heat check**. Anyone past 1h 30m in the sun gets an automatic radio reminder (the clock keeps running). At 2:13pm Marcus crosses 2h 30m: Mina recommends a relief and drafts a replacement. Tap *Approve* and he is released by radio.

## Checks

```bash
npx tsc --noEmit
for s in check-csp check-engine check-report check-heat check-incident; do npx tsx scripts/$s.ts; done
```

`data/*.csv` is synthetic (`npm run data`). Regenerating keeps the hand-edited `sun_min` column.
