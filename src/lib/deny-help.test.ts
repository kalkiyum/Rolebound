import { describe, expect, it } from "vitest";
import { nextStep } from "./deny-help";

describe("nextStep", () => {
  it("tells someone without a grant who can give them one", () => {
    // The point is that it names approval as the route, not the exact noun.
    expect(nextStep("no_grant", "Marketing")).toMatch(/approv/i);
  });

  it("names the role in the advice, so it reads like this role", () => {
    expect(nextStep("recipient_not_allowed", "Marketing")).toContain("Marketing");
  });

  it("does not pretend a dissolved role can be reopened", () => {
    const advice = nextStep("role_dissolved", "Marketing");
    expect(advice).toMatch(/closed|dissolved/i);
    expect(advice).not.toMatch(/try again/i);
  });

  it("says what to fix for a missing reason", () => {
    expect(nextStep("missing_reason", "Marketing")).toMatch(/what the money is for/i);
  });

  it("says nothing rather than something useless for an unknown code", () => {
    expect(nextStep(undefined, "Marketing")).toBeNull();
    expect(nextStep("something_new", "Marketing")).toBeNull();
  });
});

describe("a signature that does not check out", () => {
  it("tells the person how to recover rather than what went wrong", () => {
    const advice = nextStep("bad_signature", "Marketing");
    expect(advice).toBeTruthy();
    expect(advice).toMatch(/sign out and back in/i);
  });
});
