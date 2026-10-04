import type { Metadata } from "next";
import Link from "next/link";
import { textLink } from "@/components/marketing/site";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { safeNextPath } from "../safe-next";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Start free: 25 leads a month, manual approval, no card needed.",
};

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined);
  const signInHref = next === "/dashboard" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <p className="stopwatch text-xs text-foreground/65">Free account</p>
        <CardTitle>
          <h1 className="text-2xl leading-tight text-balance">Answer your next lead in under a minute</h1>
        </CardTitle>
        <CardDescription className="text-foreground/70">
          Free covers 25 leads a month, with every reply approved by you. No card needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignUpForm next={next} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-foreground/70">
        Already have an account?&nbsp;
        <Link href={signInHref} className={cn(textLink, "font-medium text-foreground")}>
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
