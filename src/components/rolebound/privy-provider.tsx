"use client";

import { PrivyProvider } from "@privy-io/react-auth";

/**
 * Wraps the app only when Privy is configured. In local Anvil development
 * the variables are blank and this renders nothing of its own, so the
 * development loop keeps working without credentials.
 */
export function Providers({
  appId,
  children,
}: {
  appId: string | undefined;
  children: React.ReactNode;
}) {
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Every member needs a key that can sign a justification, so the
        // wallet is created at login rather than asked for later.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#111111" },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
