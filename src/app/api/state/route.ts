import { clearAppState, readAppState, writeAppState } from "@/lib/server-state";

export const runtime = "nodejs";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const actual = new URL(origin);
  const expected = new URL(request.url);
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  return actual.protocol === expected.protocol && actual.port === expected.port && (actual.hostname === expected.hostname || (loopback.has(actual.hostname) && loopback.has(expected.hostname)));
}

export async function GET() {
  const value = readAppState();
  return Response.json(value ? JSON.parse(value) : null, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const text = await request.text();
  if (text.length > 1_000_000) return Response.json({ error: "State exceeds 1 MB limit." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "State must be a JSON object." }, { status: 400 });
  writeAppState(body);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
  clearAppState();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
