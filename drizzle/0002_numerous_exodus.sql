ALTER TABLE "members" ADD COLUMN "invite_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "members_invite_code_idx" ON "members" USING btree ("invite_code");