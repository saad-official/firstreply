import type { Metadata } from "next";
import Link from "next/link";
import { textLink } from "@/components/marketing/site";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { safeNextPath } from "../safe-next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const expired = params.expired !== undefined;
  const signUpHref = next === "/dashboard" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(next)}`;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <p className="stopwatch text-xs text-foreground/65">Sign in</p>
        <CardTitle>
          <h1 className="text-2xl leading-tight">Welcome back</h1>
        </CardTitle>
        <CardDescription className="text-foreground/70">Your queue is waiting. New leads keep their place until you&rsquo;re in.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {expired ? (
          <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Your session ended. Sign in again to continue.
          </p>
        ) : null}
        <SignInForm next={next} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-foreground/70">
        New to Firstreply?&nbsp;
        <Link href={signUpHref} className={cn(textLink, "font-medium text-foreground")}>
          Create an account
        </Link>
      </CardFooter>
    </Card>
  );
}
