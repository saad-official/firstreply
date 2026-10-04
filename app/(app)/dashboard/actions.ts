"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormActionState } from "@/components/app/action-result";
import { requireOrgContext } from "@/lib/auth/session";
import { seedDemoWorkspace } from "@/lib/services/demo";
import { actionError } from "../_lib/action-errors";

/**
 * "Load demo workspace" (spec 3.7): six synthetic leads through the real
 * pipeline, then straight to the queue where the drafts wait. Idempotent in
 * the service.
 */
export async function loadDemoWorkspace(): Promise<FormActionState> {
  const ctx = await requireOrgContext();
  try {
    await seedDemoWorkspace(ctx.org);
  } catch (error) {
    return actionError(error, "seed demo workspace");
  }
  revalidatePath("/", "layout");
  redirect("/queue");
}
