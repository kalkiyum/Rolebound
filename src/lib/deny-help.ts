/**
 * What to do about a refusal.
 *
 * The gate's own message says what happened — "You do not have spend rights
 * on Marketing" — and stops there, correctly: it is a rule engine, not a
 * help desk. This turns each refusal into the next move, because a person
 * looking at a blocked payment already knows it was blocked. What they do
 * not know is who to ask.
 */
export function nextStep(
  code: string | undefined,
  roleName: string,
): string | null {
  switch (code) {
    case "no_grant":
      return `Ask someone who can approve on ${roleName} to give you spend rights. Nothing you can change on this form will get past it.`;
    case "role_dissolved":
      return `${roleName} has been closed and its balance returned to the treasury. Its history stays readable, but nothing more goes out of it.`;
    case "missing_reason":
      return "Say what the money is for. One sentence is enough, and it is what gets committed onchain.";
    case "invalid_amount":
      return "Enter an amount greater than zero.";
    case "bad_signature":
      return "Your wallet did not sign these exact terms. Reload the page and enter the payment again — if it keeps happening, sign out and back in so your wallet is reconnected.";
    case "recipient_not_allowed":
      return `${roleName} can only pay addresses on its own list. Ask an approver to add this one, or pay from a role that already allows it.`;
    default:
      return null;
  }
}
