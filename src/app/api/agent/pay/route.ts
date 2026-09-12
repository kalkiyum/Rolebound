import { isAddress } from "viem";
import { authenticateAgent } from "@/lib/agents";
import { SpendDenied } from "@/lib/gate";
import { requestPayment } from "@/lib/payments";

/**
 * The agent entry point — and deliberately almost nothing.
 *
 * Authentication differs (an API key rather than a Privy session) because
 * that is the only thing that genuinely differs about an agent. Everything
 * after the identity is resolved is `requestPayment()`, the same call the UI
 * makes, which begins by calling the same gate. A parallel implementation
 * here would eventually grow parallel limits, and an agent quietly spending
 * outside its cap is the exact failure this product exists to prevent.
 *
 *   curl -X POST /api/agent/pay \
 *     -H "authorization: Bearer rb_live_…" \
 *     -d '{"roleId":"…","to":"0x…","amount":"250.00","reason":"Invoice 204"}'
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const key = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  const agent = await authenticateAgent(key);
  if (!agent) {
    return Response.json(
      { status: "unauthorized", error: "Unknown or missing API key." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { status: "blocked", error: "Body must be JSON." },
      { status: 400 },
    );
  }

  const roleId = typeof body.roleId === "string" ? body.roleId : "";
  const to = typeof body.to === "string" ? body.to : "";
  const reason = typeof body.reason === "string" ? body.reason : "";

  if (!roleId) return bad("roleId is required.");
  if (!isAddress(to)) return bad("`to` must be an Ethereum address.");
  if (!reason.trim()) {
    return bad("Every payment needs a reason. Say what this is for.");
  }

  let amount: bigint;
  try {
    amount = parseAmount(body.amount);
  } catch {
    return bad("`amount` must be a decimal string of USDC, e.g. \"250.00\".");
  }

  try {
    const outcome = await requestPayment({
      orgId: agent.orgId,
      roleId,
      memberId: agent.id,
      to,
      amount,
      reason,
    });

    const status = outcome.status === "blocked" ? 403 : 200;
    return Response.json(outcome, { status });
  } catch (err) {
    // The gate refuses by throwing, and every caller is expected to catch it
    // — the UI turns it into a message, and here it becomes a refusal an
    // agent can actually act on. A refusal is the product working, not a
    // server fault, so it must never surface as a 500: an agent that reads
    // 500 retries, and a retry loop against a revoked grant is noise at
    // best. 403 with the reason and the code says: understood, refused,
    // do not try again.
    if (err instanceof SpendDenied) {
      return Response.json(
        { status: "blocked", code: err.code, error: err.message },
        { status: 403 },
      );
    }
    throw err;
  }
}

function bad(error: string) {
  return Response.json({ status: "blocked", error }, { status: 400 });
}

/**
 * USDC has six decimals and JSON has no integers wide enough to be trusted
 * with money, so amounts arrive as strings and are parsed exactly. Anything
 * that is not a plain decimal is refused rather than coerced — `Number()`
 * would happily turn "1e9" or "" into a payment.
 */
function parseAmount(raw: unknown): bigint {
  if (typeof raw !== "string" || !/^\d+(\.\d{1,6})?$/.test(raw.trim())) {
    throw new Error("not a decimal amount");
  }
  const [whole, fraction = ""] = raw.trim().split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
