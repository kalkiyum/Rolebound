import { describe, expect, it } from "vitest";
import { artifact } from "../../test/chain";
import { roleboundPayAbi } from "./abi";

/**
 * The app encodes calldata from a hand-written ABI. If the contract's
 * signature changes and this copy does not, transactions are built against a
 * function that no longer exists — and the failure surfaces as an opaque
 * revert at payment time. Catch it here instead.
 */
describe("the app's ABI matches the compiled contract", () => {
  const compiled = artifact("RoleboundPay").abi as Array<Record<string, unknown>>;

  const normalize = (entry: Record<string, unknown>) => ({
    type: entry.type,
    name: entry.name,
    inputs: (entry.inputs as Array<Record<string, unknown>> | undefined)?.map(
      (i) => ({ name: i.name, type: i.type, indexed: i.indexed ?? undefined }),
    ),
  });

  it.each(roleboundPayAbi.map((e) => [e.type, e.name, e] as const))(
    "%s %s",
    (type, name, entry) => {
      const match = compiled.find((c) => c.type === type && c.name === name);
      expect(match, `${type} ${name} is missing from the compiled contract`).toBeDefined();
      expect(normalize(entry as unknown as Record<string, unknown>)).toEqual(
        normalize(match!),
      );
    },
  );
});
