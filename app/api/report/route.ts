import { NextResponse } from "next/server";
import { parseReport, ReportEvent, ReportResult, RosterRow } from "@/lib/report";

export const runtime = "nodejs";

/**
 * Reads a messy report (typed or transcribed from voice) into roster events.
 * With OPENAI_API_KEY the model reads it; it may only return ids that are on the roster.
 * Without a key, or if the model fails, a rules reader handles it so the demo never breaks.
 */
export async function POST(req: Request) {
  const { text, roster } = (await req.json()) as { text: string; roster: RosterRow[] };
  if (!text?.trim()) return NextResponse.json({ source: "rules", events: [], ambiguous: [], unclear: true } satisfies ReportResult);

  const rules = parseReport(text, roster);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json(rules);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          {
            role: "system",
            content: [
              "You read short, noisy radio or voice reports from a festival and extract roster changes.",
              "You are given the on-shift roster (id, name, zone). Match people by name, nickname or description plus zone.",
              'Return JSON {"events":[{"kind":"no_show"|"heat_out","volunteerId":"..."}]}.',
              "no_show = a rostered person has not arrived. heat_out = a person is struggling in the heat and must rest.",
              "Only use ids from the roster. If unsure who someone is, leave them out. Ignore anything that is not a roster change.",
            ].join(" "),
          },
          { role: "user", content: JSON.stringify({ report: text, roster }) },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json(rules);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { events?: ReportEvent[] };
    const ids = new Set(roster.map((r) => r.id));
    const events = (parsed.events ?? []).filter(
      (e) => ids.has(e.volunteerId) && (e.kind === "no_show" || e.kind === "heat_out"),
    );
    if (!events.length) return NextResponse.json(rules);
    return NextResponse.json({ source: "ai", events, ambiguous: [], unclear: false } satisfies ReportResult);
  } catch {
    return NextResponse.json(rules);
  }
}
