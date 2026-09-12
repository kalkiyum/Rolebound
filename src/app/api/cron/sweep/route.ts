import { timingSafeEqual } from "node:crypto";
import { runSweep, type SweepResult } from "@/lib/schedules";

/**
 * The recurring-payments tick.
 *
 * Deliberately a plain HTTP endpoint rather than a platform-specific cron
 * entry point: it can be driven by Vercel Cron, by a local timer, or by hand
 * during a demo, and none of those is a different code path. Whatever calls
 * it, the work is the same call the UI would make.
 *
 * Guarded by a shared secret because it moves money. With `CRON_SECRET`
 * unset the endpoint refuses everything — an unguarded sweep left open to
 * the internet is worse than one that never runs.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { error: "Not authorized to run the sweep." },
      { status: 401 },
    );
  }

  const results = await runSweep();

  return Response.json({
    ran: results.length,
    // Amounts are strings: a retainer in base units overflows JSON's number.
    results: results.map(serialize),
  });
}

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

function serialize(result: SweepResult) {
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value,
    ]),
  );
}
