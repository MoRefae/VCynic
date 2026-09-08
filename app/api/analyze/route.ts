import { NextResponse } from "next/server";

// Runs on the Node.js runtime (not Edge) so we can stream the uploaded file
// and talk to a plain HTTP backend without Edge-runtime restrictions.
export const runtime = "nodejs";

// The real analysis can take well over a minute (multiple LLM calls via
// CrewAI). If this app is ever deployed to a serverless host with a shorter
// default function timeout (e.g. Vercel's Hobby plan defaults to 10s), raise
// that host's timeout setting too -- this constant alone won't help there.
export const maxDuration = 300;

/**
 * VCPILOT_API_URL and VCPILOT_API_KEY are read WITHOUT the NEXT_PUBLIC_
 * prefix on purpose: that keeps them server-side only. Never rename these
 * with a NEXT_PUBLIC_ prefix, or the API key would ship to every visitor's
 * browser in plain text.
 */
const VCPILOT_API_URL = process.env.VCPILOT_API_URL;
const VCPILOT_API_KEY = process.env.VCPILOT_API_KEY;

export async function POST(req: Request) {
  if (!VCPILOT_API_URL) {
    return NextResponse.json(
      { error: "The analysis service is not configured. Set VCPILOT_API_URL on the server." },
      { status: 503 }
    );
  }

  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart form data with a PDF file." },
      { status: 400 }
    );
  }

  const file = incoming.get("file");

  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: "Select a PDF pitch deck to analyze." },
      { status: 400 }
    );
  }

  const outgoing = new FormData();
  const filename = file instanceof File ? file.name : "deck.pdf";
  outgoing.append("file", file, filename);

  let upstream: Response;
  try {
    upstream = await fetch(
      // English is the only supported report language; the upstream API still
      // takes the parameter, so it is pinned here rather than read from input.
      `${VCPILOT_API_URL}/api/v1/analyze-pitch-deck?language=en`,
      {
        method: "POST",
        headers: VCPILOT_API_KEY ? { "X-API-Key": VCPILOT_API_KEY } : undefined,
        body: outgoing,
      }
    );
  } catch (err) {
    console.error("Could not reach VCPilot API:", err);
    return NextResponse.json(
      { error: "Could not reach the analysis service. Please try again shortly." },
      { status: 502 }
    );
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    return NextResponse.json(
      { error: "The analysis service returned an unreadable response." },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const detail = (data as { detail?: { message?: string } })?.detail;
    return NextResponse.json(
      { error: detail?.message || "The analysis could not be completed." },
      { status: upstream.status }
    );
  }

  // `data` is a VCPilotReport (see vcpilot_api.py's VCPilotReport model) --
  // passed straight through so the dashboard can render it directly.
  return NextResponse.json(data);
}
