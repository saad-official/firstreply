import Link from "next/link";
import { cn } from "@/lib/utils";

/** Inline error from a Server Action, with an upgrade link when a plan limit was hit. */
export function FormMessage({
  error,
  upgradeUrl,
  className,
}: {
  error?: string | null;
  upgradeUrl?: string | null;
  className?: string;
}) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        upgradeUrl
          ? "border-lemon bg-lemon/25 text-lemon-foreground dark:text-lemon"
          : "border-destructive/30 bg-destructive/5 text-destructive",
        className,
      )}
    >
      {error}
      {upgradeUrl ? (
        <>
          {" "}
          <Link href={upgradeUrl} className="font-semibold underline underline-offset-3">
            See plans
          </Link>
        </>
      ) : null}
    </p>
  );
}
