import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  numeric,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Amounts are token BASE UNITS held as exact numeric strings (USDC has 6
 * decimals, so "1500000" is 1.50 USDC). Never store them as floats — a
 * rounding error here is a payment discrepancy.
 */
const baseUnits = (name: string) => numeric(name, { precision: 78, scale: 0 });
const address = (name: string) => varchar(name, { length: 42 });
const hash32 = (name: string) => varchar(name, { length: 66 });

export const memberKind = pgEnum("member_kind", ["person", "agent"]);
export const roleStatus = pgEnum("role_status", ["active", "dissolved"]);
export const grantCapability = pgEnum("grant_capability", ["spend", "approve"]);
export const paymentStatus = pgEnum("payment_status", [
  "pending_approval",
  "executing",
  "executed",
  "failed",
  "blocked",
]);
export const scheduleStatus = pgEnum("schedule_status", [
  "active",
  "paused",
  "cancelled",
]);
export const scheduleDirection = pgEnum("schedule_direction", [
  "treasury_to_role",
  "role_to_recipient",
]);
export const connectionStatus = pgEnum("connection_status", [
  "active",
  "closed",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  treasuryWalletId: text("treasury_wallet_id"),
  treasuryAddress: address("treasury_address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A role IS a Privy server wallet. The budget is the wallet's balance —
 * there is deliberately no balance column to drift out of sync with chain.
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    privyWalletId: text("privy_wallet_id").notNull(),
    address: address("address").notNull(),
    /** Enforced in the Privy enclave. */
    capPerTx: baseUnits("cap_per_tx").notNull(),
    /** Enforced by the application, not the enclave. See PRD §5. */
    capMonthly: baseUnits("cap_monthly"),
    allowedContracts: jsonb("allowed_contracts")
      .$type<string[]>()
      .notNull()
      .default([]),
    allowedRecipients: jsonb("allowed_recipients")
      .$type<string[]>()
      .notNull()
      .default([]),
    status: roleStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("roles_org_idx").on(t.orgId)],
);

/** People and agents share this table on purpose — same grants, same caps. */
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: memberKind("kind").notNull(),
    displayName: text("display_name").notNull(),
    /** People authenticate through Privy. */
    privyUserId: text("privy_user_id"),
    /** Agents authenticate with an API key; only the hash is stored. */
    apiKeyHash: text("api_key_hash"),
    /** Embedded wallet address — the key that signs justifications. */
    address: address("address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("members_org_idx").on(t.orgId),
    index("members_privy_user_idx").on(t.privyUserId),
  ],
);

/**
 * Authority itself. `revokedAt IS NULL` is the single source of truth every
 * signing path reads — see assertCanSpend().
 */
export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    capability: grantCapability("capability").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("grants_role_idx").on(t.roleId),
    index("grants_member_idx").on(t.memberId),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Owned by the ROLE, not by whoever created it. Survives offboarding. */
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => members.id, {
      onDelete: "set null",
    }),
    direction: scheduleDirection("direction").notNull(),
    toAddress: address("to_address"),
    token: address("token").notNull(),
    amount: baseUnits("amount").notNull(),
    /** Cron expression; evaluated by the hourly sweep. */
    cadence: text("cadence").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    status: scheduleStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("schedules_role_idx").on(t.roleId),
    index("schedules_due_idx").on(t.status, t.nextRunAt),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    toAddress: address("to_address").notNull(),
    token: address("token").notNull(),
    amount: baseUnits("amount").notNull(),
    /** Plaintext stays app-side; only the hash goes onchain. PRD §6. */
    reason: text("reason").notNull(),
    reasonHash: hash32("reason_hash").notNull(),
    /** Actor's embedded-wallet signature over the authorization payload. */
    actorSignature: text("actor_signature"),
    nonce: text("nonce"),
    status: paymentStatus("status").notNull(),
    blockedReason: text("blocked_reason"),
    approvedBy: uuid("approved_by").references(() => members.id, {
      onDelete: "set null",
    }),
    approvalReason: text("approval_reason"),
    txHash: hash32("tx_hash"),
    scheduleId: uuid("schedule_id").references(() => schedules.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("payments_role_idx").on(t.roleId),
    index("payments_status_idx").on(t.status),
    index("payments_tx_idx").on(t.txHash),
  ],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    dappName: text("dapp_name"),
    wcTopic: text("wc_topic").notNull(),
    status: connectionStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("connections_role_idx").on(t.roleId)],
);

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: uuid("actor_id").references(() => members.id, {
      onDelete: "set null",
    }),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
    subjectId: uuid("subject_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("activity_org_created_idx").on(t.orgId, t.createdAt)],
);
