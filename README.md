# Rolebound

**Bounded, revocable, accountable spending authority for onchain teams.**

Live: **https://rolebound.vercel.app** · Demo org: [Northwind Labs](https://rolebound.vercel.app/orgs/051a54a0-7d9b-46ea-9176-e251443e7da7)
Built for the **Privy · Best B2B Financial Product** track, ETHOnline 2026. Base Sepolia.

---

## The problem

An organization that wants to let someone spend its funds has two options, both bad:

1. **Add them to the multisig** — unbounded and permanent. The *grant* is all-or-nothing.
2. **Wire them the budget** — unrecoverable the moment it lands.

There is no bounded middle, so teams over-permission by default. Three things follow, and each is a feature here: authority is larger than the job, standing payments outlive the person who set them up, and the answer to "why did we send 2,000 USDC?" lives in Discord.

## The inversion

**The role holds the money. Not the person.**

| Instead of | Rolebound |
|---|---|
| Permission rows gating a shared treasury | Each role is its own wallet with its own policy |
| A budget tracked in a spreadsheet | The budget **is** the role wallet's balance |
| Offboarding = remove a signer | Offboarding = revoke a grant; the money never moved |
| "Why?" lives in Discord | The reason is committed onchain in the same transaction |

A contractor doesn't get keys. They get a **grant** on a role: a capability (`spend` or `approve`), bounded by that role's per-transaction and monthly caps, revocable in one click, and never transferring custody of anything.

## How it works

```
Treasury (Privy server wallet)
   └─ top-ups ──▶ Role wallet (Privy server wallet + policy)
                     │  grant: member → spend | approve
                     ▼
                  assertCanSpend()  ── the single gate
                     │
                     ▼
                  RoleboundPay.pay(roleId, token, to, amount, reasonHash, actor)
                     │
                     ▼
                  Payment event — money and justification in one transaction
```

**One gate, one call site.** `assertCanSpend()` is the only thing that authorizes a payment, and `requestPayment()` is the only caller. The browser, the agent API and the scheduled retainers all funnel through it, so there is no second place a cap can be forgotten — the exact failure this product exists to prevent.

**The reason is not a memo field.** It is hashed and committed on chain in the same transaction that moves the money, so the record cannot drift from the transfer. The plaintext stays in the app; the commitment is public and permanent. The activity feed reads the hash back off the chain and shows a verified badge only when it matches what we hold.

**The actor signs.** A role wallet's key lives in Privy's enclave, so its signature proves a *role* paid and says nothing about who asked. Before any payment leaves the browser, the member signs an EIP-712 authorization binding their embedded wallet to this amount, this recipient and this reason. The server recovers the signer and refuses on any mismatch — a signature over different terms is a refusal, not a warning.

## What Privy does here

| Privy feature | Used for |
|---|---|
| **Server wallets** | One wallet per role, plus the treasury. The role holds the budget. |
| **Policy engine** | Contract and recipient allowlists, plus a hard per-transaction ceiling — enclave-enforced, so they hold even if this app is wrong |
| **Embedded wallets** | Member login, and the key that signs each justification |
| **Authorization keys** | Signing gated on a live grant; revocation takes effect on the next call |

### Two limits, and which one the enclave holds

| | Enforced by | Over it |
|---|---|---|
| **Per-transaction cap** | `assertCanSpend()`, app layer | Routes to an approver, then executes |
| **Ceiling** (the role's monthly budget) | Privy policy, in the enclave | Nobody can authorize it — approver included |
| **Contract allowlist** | Privy policy, in the enclave | Refused: the wallet can only call RoleboundPay |
| **Recipient allowlist** | Privy policy, in the enclave | Refused |

The contract allowlist is the load-bearing one: a role wallet's direct `USDC.transfer`, and an `approve` to any spender other than RoleboundPay, are both refused with `policy_violation`. A compromised app server still cannot drain a role wallet to an arbitrary address — the only thing the wallet can do is commit a justification and pay.

**An honest note on how we learned the difference.** Our Phase 0 spike (2026-09-10) found calldata conditions were accepted at policy creation and then ignored at signing, so we documented per-transaction caps as app-layer only and depended on nothing else. That finding is now stale: Privy enforces calldata conditions. We found out because a 1,200 payment from a role whose policy capped `pay.amount` at 500 came back `policy_violation` — the enclave was refusing the exact case the approval queue exists to serve.

The fix was to stop conflating the two limits. The per-transaction cap is a *soft* limit and always was: going over it is a normal, designed outcome that needs a second person. The ceiling is the hard one, and now that calldata conditions are enforced it is a real enclave-side control rather than an aspiration.

## The six beats

1. **Three roles, holding money.** Roles hold funds, not people.
2. **A contractor pays.** Amount + reason, done in seconds. In a multisig this is three signers and a group chat.
3. **Over the cap.** Routed to approval; the approver signs off with their *own* reason, then it executes.
4. **The agent pays.** Same members table, same grants, same caps — authenticated with an API key instead of a session. Your agent doesn't get a wallet, it gets a role.
5. **Remove the contractor.** The grant dies mid-session, and their two standing payments are surfaced for triage: cancel, reassign, or keep.
6. **The record.** Activity by role — who, which role, how much, to whom, why, verifiable against the chain.

## Deployed contracts (Base Sepolia)

| Contract | Address |
|---|---|
| `RoleboundPay` | [`0x9Fb36d47ddD6B5509ebdC1a210058eda865D83ed`](https://sepolia.basescan.org/address/0x9Fb36d47ddD6B5509ebdC1a210058eda865D83ed) |
| `TestUSDC` | [`0xd94aa08776a7da32f64ce379d78c11d36e81c3f4`](https://sepolia.basescan.org/address/0xd94aa08776a7da32f64ce379d78c11d36e81c3f4) |

**On the token:** the demo runs on a project-deployed six-decimal test token, not Circle's canonical Base Sepolia USDC. Circle's faucet is rationed at roughly ten a day and the demo moves several thousand across six payments, so the choice was between a mintable token and a demo whose amounts read in fractions of a dollar. `RoleboundPay` takes the token as an argument — nothing about the payment pipeline is specific to either.

## Running it locally

No credentials, no network, no faucet — the local loop runs entirely against Anvil.

```bash
pnpm install

# Terminal 1 — a local chain
pnpm chain

# Terminal 2 — deploys contracts, writes .env.local, seeds a full org
pnpm chain:setup
pnpm dev
```

`chain:setup` blanks the Privy variables in `.env.local` on purpose: Privy cannot sign for chain 31337, so real credentials would point the dev server at a backend that has never heard of the locally-provisioned wallets.

To run against Privy and Base Sepolia instead, fill in `.env` from `.env.example` and use `pnpm dev:privy`.

### Tests

```bash
pnpm test
```

160 tests. They are not mocks: the suite stands up its own Anvil instance and its own Postgres database, deploys the real contracts, and moves real (test) money through the real gate. The database is hard-overridden to a test URL in `test/db.ts`, because the suite wipes every table between cases.

### Scripts

| Command | What it does |
|---|---|
| `pnpm chain` / `pnpm chain:setup` | Local chain, contracts, seeded org |
| `pnpm dev` / `pnpm dev:privy` | Dev server, with or without Privy |
| `pnpm test` | Full suite against Anvil + Postgres |
| `pnpm deploy:testnet` | Deploys the demo token to Base Sepolia |
| `pnpm seed:testnet` | Seeds the demo org against Base Sepolia + hosted Postgres |
| `pnpm verify:ui <orgId>` | Walks every screen at 1280px and 390px, fails on overflow or short tap targets |
| `pnpm verify:login <orgId> <email>` | Drives a real Privy login in a real browser |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui · Drizzle + Postgres (Neon) · viem · Foundry · Privy server + embedded wallets · Vercel

## Documents

- [`PRD.md`](./PRD.md) — the specification, including the Phase 0 policy verdict
- [`BUILD.md`](./BUILD.md) — the build plan, 41 steps, with what is done and what is not
