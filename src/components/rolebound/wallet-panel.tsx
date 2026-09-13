"use client";

import { useState } from "react";
import { useExportWallet, useWallets } from "@privy-io/react-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AddressChip } from "@/components/rolebound/primitives";

/**
 * The key a person signs with, and the way to take it elsewhere.
 *
 * Two things have to be said plainly here, because they pull in opposite
 * directions and someone who understands only one of them will make a bad
 * decision. This wallet holds no money — importing it into MetaMask shows an
 * empty account, and that is not a bug. But it *signs*, so whoever holds the
 * key can authorize payments as this person, up to whatever their roles
 * allow. It is a credential, not a balance.
 *
 * The export modal runs on Privy's own origin in an iframe: the key is shown
 * to the person and never becomes reachable by this app.
 */
export function WalletPanel({ address }: { address: string | null }) {
  const { wallets } = useWallets();
  const { exportWallet } = useExportWallet();
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  // The embedded wallet is the one Privy made at login and the only one it
  // can export. A wallet the person connected themselves is theirs already.
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const shown = embedded?.address ?? address;

  if (!shown) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        No wallet on this account yet. One is created the first time you sign
        in — give it a moment and reload.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <AddressChip address={shown} className="block text-sm" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shown);
              setCopied(true);
            } catch {
              toast.error("Could not copy. Select the address and copy it manually.");
            }
          }}
        >
          {copied ? "Copied" : "Copy address"}
        </Button>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground text-pretty">
          This wallet holds no money. Payments come out of role wallets, never
          out of yours — what this key does is sign, so an audit can say you
          authorized a payment and not merely that the role paid someone.
        </p>

        {embedded ? (
          <>
            <p className="text-sm text-muted-foreground text-pretty">
              You can take the key with you. Exporting shows the private key on
              Privy&rsquo;s own domain, so this app never sees it, and you can
              import it into MetaMask or any other wallet. Expect an empty
              balance there — and keep it safe, because anyone holding it can
              authorize payments as you.
            </p>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportWallet({ address: embedded.address });
                } catch {
                  toast.error("The export did not open. Try again.");
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? "Opening…" : "Export private key"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-pretty">
            This address was connected rather than created here, so there is no
            key for Rolebound to export — you already hold it.
          </p>
        )}
      </div>
    </div>
  );
}
