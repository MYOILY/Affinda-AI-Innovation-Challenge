import { NextResponse } from "next/server";
import { radioScript, RadioFacts, spokenDuration } from "@/lib/heat";

export const runtime = "nodejs";

/**
 * The heat monitor decides WHO gets a reminder and WHEN (sun time over the limit, lib/heat.ts).
 * This route only decides how it sounds. The template is always the fallback, and a model's
 * wording is used only if it passes the checks below, so a bad reply can never reach an earpiece.
 */
export async function POST(req: Request) {
  const f = (await req.json()) as RadioFacts;
  const template = radioScript(f);
  const key = process.env.OPENAI_API_KEY;
  if (!key || !f.firstName) return NextResponse.json({ source: "template", text: template });

  const system = [
    "You are Sharon, the friendly AI assistant for the safety team at a Melbourne summer festival.",
    "You write one short message that is spoken aloud into a volunteer's earpiece, so write for the ear: two or three short sentences, no symbols, no emojis, no lists.",
    `Start with 'Hey ${f.firstName}, this is Sharon.'`,
    f.kind === "reminder"
      ? `Facts you must use: they have been in the sun for ${spokenDuration(f.sunMin)}. Tell them to drink some water and take any shade they can. Do NOT tell them to leave their post or promise relief: only a person on the safety team releases them.`
      : "Facts you must use: they are relieved, they should walk to the Break Area, rest twenty minutes and drink some water.",
    "Maximum 40 words. Return JSON: {\"text\": string}.",
  ].join(" ");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(f) },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return NextResponse.json({ source: "template", text: template });
    const data = await res.json();
    const text = String((JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { text?: string }).text ?? "").trim();

    const ok =
      text.length > 0 &&
      text.length <= 300 &&
      text.toLowerCase().startsWith(`hey ${f.firstName.toLowerCase()}, this is sharon`) &&
      /water/i.test(text) &&
      (f.kind === "relieved" || /shade/i.test(text)) &&
      !/(leave|abandon) (your )?post/i.test(text);
    return NextResponse.json(ok ? { source: "ai", text } : { source: "template", text: template });
  } catch {
    return NextResponse.json({ source: "template", text: template });
  }
}
