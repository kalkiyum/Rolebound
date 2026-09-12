import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walletBackend } from "./index";

const KEYS = [
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "NEXT_PUBLIC_CHAIN_ID",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function configure(opts: { privy: boolean; chainId: string }) {
  process.env.NEXT_PUBLIC_CHAIN_ID = opts.chainId;
  if (opts.privy) {
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app-id";
    process.env.PRIVY_APP_SECRET = "app-secret";
  } else {
    delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
  }
}

describe("walletBackend", () => {
  it("uses Privy on a real chain", () => {
    configure({ privy: true, chainId: "84532" });

    expect(walletBackend().kind).toBe("privy");
  });

  it("uses the local backend on Anvil when Privy is absent", () => {
    configure({ privy: false, chainId: "31337" });

    expect(walletBackend().kind).toBe("local");
  });

  it("refuses the combination Privy cannot serve: configured keys, local chain", () => {
    // Privy has no eip155:31337. Left to itself this returns the Privy
    // backend, which then fails deep inside an SDK call with "Invalid wallet
    // ID" against locally-provisioned wallets — a genuinely puzzling hour.
    configure({ privy: true, chainId: "31337" });

    expect(() => walletBackend()).toThrow(/31337|local chain|Anvil/i);
  });

  it("still refuses a chain neither backend can serve", () => {
    configure({ privy: false, chainId: "84532" });

    expect(() => walletBackend()).toThrow(/No wallet backend/i);
  });
});
