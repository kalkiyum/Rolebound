import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";

/**
 * One organization goes straight in. Nobody wants a picker with one item on
 * it, and the demo should open on something real.
 */
export default async function Home() {
  // Nothing on this page reads cookies or headers, so Next would happily
  // prerender it at build time — freezing "no organization yet" into the
  // deployment and never noticing the seed that ran afterwards.
  await connection();

  const orgs = await db.query.organizations.findMany({
    orderBy: asc(schema.organizations.createdAt),
  });

  if (orgs.length === 1) redirect(`/orgs/${orgs[0].id}`);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Rolebound
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
        Spending authority that follows the role, not the person.
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground text-pretty">
        A role is a wallet with a budget and a policy. People and agents are
        granted access to it. Remove someone and their ability to spend is gone
        on the next request — and every payment carries a reason committed
        onchain in the same transaction that moved the money.
      </p>

      {orgs.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-border p-6">
          <p className="text-sm font-medium">No organization yet</p>
          <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
            Seed one for local development with{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              pnpm chain
            </code>{" "}
            in one terminal, then{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              pnpm chain:setup
            </code>{" "}
            in another.
          </p>
        </div>
      ) : (
        <ul className="mt-10 space-y-2">
          {orgs.map((org) => (
            <li key={org.id}>
              <Button asChild variant="outline" className="w-full justify-start">
                <Link href={`/orgs/${org.id}`}>{org.name}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
