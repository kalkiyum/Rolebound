"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import { toast } from "sonner";
import { payAction, type ActionResult } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Outcome } from "@/components/rolebound/primitives";
import { AuthorityDial } from "@/components/rolebound/authority-dial";
import { GateTrace, type Check } from "@/components/rolebound/gate-trace";
import { previewGate, type Limits } from "@/lib/preview";
import { formatUsdc, parseUsdc } from "@/lib/format";
import { nextStep } from "@/lib/deny-help";
import {
  AUTHORIZATION_TYPES,
  authorizationDomain,
  hashReason,
} from "@/lib/authorization";
import { roleIdToBytes32 } from "@/lib/ids";

/**
 * What the actor's wallet is asked to sign. Returns the signature and the
 * nonce it covers, so the two travel together to the server — a signature
 * submitted without its nonce cannot be checked against anything.
 */
type SignAuthorization = (input: {
  roleId: string;
  to: `0x${string}`;
  amount: bigint;
  reason: string;
}) => Promise<{ signature: `0x${string}`; nonce: string }>;

interface PayFormProps {
  orgId: string;
  roleId: string;
  roleName: string;
  capPerTx: string;
  remainingMonthly: string | null;
  capMonthly: string | null;
  canSpend: boolean;
  /**
   * Whether there is a Privy wallet in this session to sign with. False in
   * local development, where the app runs against Anvil with no Privy app
   * configured and members have no embedded wallets.
   */
  signingEnabled: boolean;
}

/**
 * Chooses between the signing and unsigned forms once, from a prop the server
 * renders. The branch is a component boundary rather than a condition inside
 * one component because the signing path calls Privy hooks, and those cannot
 * be called when the provider is absent.
 */
export function PayForm(props: PayFormProps) {
  return props.signingEnabled ? (
    <SigningPayForm {...props} />
  ) : (
    <PayFormFields {...props} sign={null} />
  );
}

function SigningPayForm(props: PayFormProps) {
  const { signTypedData } = useSignTypedData();
  const { wallets } = useWallets();

  // The embedded wallet, not whatever happens to be connected. A member's
  // address on file is the one Privy created for them at login, and that is
  // what the server will check the recovered signer against.
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  const sign = useCallback<SignAuthorization>(
    async ({ roleId, to, amount, reason }) => {
      if (!embedded) {
        throw new Error(
          "Your wallet is still connecting. Give it a moment and try again.",
        );
      }

      const nonce = crypto.randomUUID();

      const { signature } = await signTypedData(
        {
          domain: authorizationDomain() as Record<string, unknown>,
          types: {
            // Wallets expect the domain's own type alongside the message's.
            // It plays no part in the struct hash, so the server verifying
            // without it recovers the same address.
            EIP712Domain: [
              { name: "name", type: "string" },
              { name: "version", type: "string" },
              { name: "chainId", type: "uint256" },
              { name: "verifyingContract", type: "address" },
            ],
            // Copied rather than spread: the shared definition is `as const`
            // so that the server's verification is typed against the exact
            // field order, and the wallet's payload wants a mutable array.
            PaymentAuthorization: [...AUTHORIZATION_TYPES.PaymentAuthorization],
          },
          primaryType: "PaymentAuthorization",
          message: {
            roleId: roleIdToBytes32(roleId),
            to,
            // Decimal string rather than a bigint: this payload is JSON on
            // its way to the wallet, and uint256 is carried as a string by
            // convention. It hashes to the same word either way.
            amount: amount.toString(),
            reasonHash: hashReason(reason),
            nonce,
          },
        } as Parameters<typeof signTypedData>[0],
        { address: embedded.address },
      );

      return { signature: signature as `0x${string}`, nonce };
    },
    [embedded, signTypedData],
  );

  return <PayFormFields {...props} sign={sign} />;
}

function PayFormFields({
  orgId,
  roleId,
  roleName,
  capPerTx,
  remainingMonthly,
  capMonthly,
  canSpend,
  sign,
}: PayFormProps & { sign: SignAuthorization | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    payAction,
    null,
  );

  // Signing happens before the action runs, and the wallet may take a moment
  // or be declined, so the button has to speak for that window too.
  const [signing, setSigning] = useState(false);
  const [signingError, setSigningError] = useState<string | null>(null);

  // Mirrored into state purely so the dial and the trace can react as the
  // form is filled in. The submitted values still come from the form itself.
  const [draft, setDraft] = useState({ amount: "", to: "", reason: "" });

  const limits: Limits = {
    capPerTx: BigInt(capPerTx),
    remainingMonthly: remainingMonthly === null ? null : BigInt(remainingMonthly),
    capMonthly: capMonthly === null ? null : BigInt(capMonthly),
  };

  const amount = parseUsdc(draft.amount.trim());
  const amountTyped = draft.amount.trim().length > 0;
  const preview = amount === null ? null : previewGate(amount, limits);
  const addressOk = /^0x[a-fA-F0-9]{40}$/.test(draft.to.trim());
  const reasonOk = draft.reason.trim().length > 0;

  const checks: Check[] = [
    { state: "ok", label: <>You hold a live <strong className="font-medium">spend</strong> grant on {roleName}</> },
    {
      state: !amountTyped ? "idle" : amount === null ? "bad" : "ok",
      label:
        amountTyped && amount === null
          ? "That is not an amount this token can hold — six decimals at most"
          : "The amount is a valid USDC figure",
    },
    {
      state: !draft.to.trim() ? "idle" : addressOk ? "ok" : "bad",
      label: draft.to.trim() && !addressOk
        ? "That recipient is not a wallet address"
        : "The recipient is an address the role's policy permits",
    },
    {
      state: reasonOk ? "ok" : "idle",
      label: "A reason is given, and gets hashed into the same transaction",
    },
    {
      state: !preview
        ? "idle"
        : preview.because === "over_per_tx_cap"
          ? "gated"
          : "ok",
      label: (
        <>
          Under {roleName}&rsquo;s{" "}
          <span className="tnum">{formatUsdc(capPerTx)}</span> per-payment cap
        </>
      ),
    },
    ...(remainingMonthly !== null
      ? [
          {
            state: (!preview
              ? "idle"
              : preview.because === "over_monthly_budget"
                ? "gated"
                : "ok") as Check["state"],
            label: (
              <>
                Within the{" "}
                <span className="tnum">{formatUsdc(remainingMonthly)}</span> left
                of this month
              </>
            ),
          },
        ]
      : []),
    ...(capMonthly !== null
      ? [
          {
            state: (!preview
              ? "idle"
              : preview.because === "over_ceiling"
                ? "bad"
                : "ok") as Check["state"],
            label: (
              <>
                Under the{" "}
                <span className="tnum">{formatUsdc(capMonthly)}</span> ceiling
                in the wallet&rsquo;s Privy policy
              </>
            ),
          },
        ]
      : []),
    ...(sign
      ? [
          {
            state: "idle" as Check["state"],
            label: "You sign it; the server recovers your address before paying",
          },
        ]
      : []),
  ];

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  // Emptying the form is a render-time adjustment rather than an effect: it
  // is derived from a new result arriving, so doing it in an effect would
  // paint the sent payment's numbers once before clearing them.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setDraft({ amount: "", to: "", reason: "" });
  }

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      // Without a wallet there is nothing to add to the form, so the default
      // submission is left alone and the server handles an unsigned payment.
      if (!sign) return;

      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);

      const to = String(data.get("to") ?? "").trim();
      const reason = String(data.get("reason") ?? "");
      const amount = parseUsdc(String(data.get("amount") ?? "").trim());

      // Let the server say why these are wrong — it owns those sentences, and
      // asking someone to sign a payment we already know is malformed is a
      // wallet prompt wasted.
      if (amount === null || !/^0x[a-fA-F0-9]{40}$/.test(to) || !reason.trim()) {
        startTransition(() => action(data));
        return;
      }

      setSigningError(null);
      setSigning(true);
      try {
        const { signature, nonce } = await sign({
          roleId,
          to: to as `0x${string}`,
          amount,
          reason,
        });
        data.set("actorSignature", signature);
        data.set("nonce", nonce);
        startTransition(() => action(data));
      } catch (err) {
        // A declined signature is a decision, not a failure. Nothing was
        // sent, and saying so is the whole of what the person needs.
        setSigningError(
          err instanceof Error && err.message
            ? err.message
            : "The payment was not signed, so nothing was sent.",
        );
      } finally {
        setSigning(false);
      }
    },
    [action, roleId, sign],
  );

  // A refusal is the product working, so it is shown rather than flashed.
  const advice = state && !state.ok ? nextStep(state.code, roleName) : null;
  const busy = pending || signing;

  if (!canSpend) {
    return (
      <div className="rounded-lg border border-dashed border-border p-5">
        <p className="text-sm font-medium">You cannot spend from {roleName}</p>
        <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
          Spending needs a live grant on this role. Someone who can already
          approve here has to add you.
        </p>
      </div>
    );
  }

  return (
    <form
      action={action}
      onSubmit={onSubmit}
      className="space-y-4"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="roleId" value={roleId} />

      <div className="grid gap-5 lg:grid-cols-[1fr_17rem]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <div className="relative">
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                placeholder="250.00"
                autoComplete="off"
                required
                value={draft.amount}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, amount: e.target.value }))
                }
                className="h-14 pr-16 font-mono text-2xl tnum md:text-2xl"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted-foreground">
                USDC
              </span>
            </div>

            <AuthorityDial
              amount={amount}
              limits={limits}
              roleName={roleName}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="to">Recipient</Label>
            <Input
              id="to"
              name="to"
              placeholder="0x…"
              autoComplete="off"
              required
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason <span className="text-muted-foreground">(required)</span>
            </Label>
            <Textarea
              id="reason"
              name="reason"
              rows={2}
              required
              value={draft.reason}
              onChange={(e) =>
                setDraft((d) => ({ ...d, reason: e.target.value }))
              }
              placeholder="Landing page design, invoice #204"
            />
            <p className="text-xs text-muted-foreground text-pretty">
              Committed onchain as a hash in the same transaction that moves the
              money. The words stay here; the commitment is public and permanent.
              {sign ? " You sign it first, so the record names you." : null}
            </p>
          </div>
        </div>

        <div className="lg:pt-7">
          <GateTrace checks={checks} />
        </div>
      </div>

      {signingError ? (
        <Outcome tone="refused" title={signingError} />
      ) : state ? (
        <Outcome
          tone={
            !state.ok
              ? "refused"
              : /approver/.test(state.message)
                ? "waiting"
                : "ok"
          }
          title={state.message}
        >
          {advice}
        </Outcome>
      ) : null}

      <Button type="submit" disabled={busy} size="lg">
        {signing
          ? "Sign in your wallet…"
          : pending
            ? "Sending…"
            : preview?.verdict === "gated"
              ? "Send for approval"
              : "Send payment"}
      </Button>
    </form>
  );
}
