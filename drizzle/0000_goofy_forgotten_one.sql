CREATE TYPE "public"."connection_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."grant_capability" AS ENUM('spend', 'approve');--> statement-breakpoint
CREATE TYPE "public"."member_kind" AS ENUM('person', 'agent');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending_approval', 'executing', 'executed', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."role_status" AS ENUM('active', 'dissolved');--> statement-breakpoint
CREATE TYPE "public"."schedule_direction" AS ENUM('treasury_to_role', 'role_to_recipient');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"role_id" uuid,
	"subject_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"dapp_name" text,
	"wc_topic" text NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"capability" "grant_capability" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "member_kind" NOT NULL,
	"display_name" text NOT NULL,
	"privy_user_id" text,
	"api_key_hash" text,
	"address" varchar(42),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"treasury_wallet_id" text,
	"treasury_address" varchar(42),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"token" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"reason" text NOT NULL,
	"reason_hash" varchar(66) NOT NULL,
	"actor_signature" text,
	"nonce" text,
	"status" "payment_status" NOT NULL,
	"blocked_reason" text,
	"approved_by" uuid,
	"approval_reason" text,
	"tx_hash" varchar(66),
	"schedule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"privy_wallet_id" text NOT NULL,
	"address" varchar(42) NOT NULL,
	"cap_per_tx" numeric(78, 0) NOT NULL,
	"cap_monthly" numeric(78, 0),
	"allowed_contracts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "role_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"created_by" uuid,
	"direction" "schedule_direction" NOT NULL,
	"to_address" varchar(42),
	"token" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"cadence" text NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"status" "schedule_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_actor_id_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_approved_by_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_org_created_idx" ON "activity" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "connections_role_idx" ON "connections" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "grants_role_idx" ON "grants" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "grants_member_idx" ON "grants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "members_org_idx" ON "members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "members_privy_user_idx" ON "members" USING btree ("privy_user_id");--> statement-breakpoint
CREATE INDEX "payments_role_idx" ON "payments" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_tx_idx" ON "payments" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "roles_org_idx" ON "roles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "schedules_role_idx" ON "schedules" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("status","next_run_at");