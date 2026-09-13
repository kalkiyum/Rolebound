import { Skeleton } from "@/components/ui/skeleton";

/**
 * Every screen here reads the chain as well as the database — balances and
 * verification verdicts are live reads, not cached columns — so a wait is
 * normal and should look like the page arriving, not like nothing happening.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="pb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2.5 h-4 w-full max-w-lg" />
      </div>

      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="mt-4 h-4 w-full max-w-md" />
            <Skeleton className="mt-2 h-4 w-full max-w-xs" />
          </div>
        ))}
      </div>
    </div>
  );
}
