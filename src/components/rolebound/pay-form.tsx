"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
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
  canSpend,
  sign,
}: PayFormProps & { sign: SignAuthorization | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    payAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Signing happens before the action runs, and the wallet may take a moment
  // or be declined, so the button has to speak for that window too.
  const [signing, setSigning] = useState(false);
  const [signingError, setSigningError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      formRef.current?.reset();
    } else {
      toast.error(state.message);
    }
  }, [state]);

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
      ref={formRef}
      action={action}
      onSubmit={onSubmit}
      className="space-y-4"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="roleId" value={roleId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="250.00"
            autoComplete="off"
            required
            className="font-mono tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            Up to{" "}
            <span className="font-mono tabular-nums">{formatUsdc(capPerTx)}</span>{" "}
            without approval
            {remainingMonthly !== null ? (
              <>
                {" · "}
                <span className="font-mono tabular-nums">
                  {formatUsdc(remainingMonthly)}
                </span>{" "}
                left this month
              </>
            ) : null}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="to">Recipient</Label>
          <Input
            id="to"
            name="to"
            placeholder="0x…"
            autoComplete="off"
            required
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            The wallet being paid.
          </p>
        </div>
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
          placeholder="Landing page design, invoice #204"
        />
        <p className="text-xs text-muted-foreground text-pretty">
          Committed onchain as a hash in the same transaction that moves the
          money. The words stay here; the commitment is public and permanent.
          {sign ? " You sign it first, so the record names you." : null}
        </p>
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

      <Button type="submit" disabled={busy}>
        {signing ? "Sign in your wallet…" : pending ? "Sending…" : "Send payment"}
      </Button>
    </form>
  );
}
