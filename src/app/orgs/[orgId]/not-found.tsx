import Link from "next/link";
import { EmptyState } from "@/components/rolebound/primitives";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      title="Not here"
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to the start</Link>
        </Button>
      }
    >
      This role, person or organization does not exist — or it belongs to a
      different organization than the one in the address.
    </EmptyState>
  );
}
