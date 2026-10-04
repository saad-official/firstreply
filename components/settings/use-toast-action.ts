"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { toast } from "sonner";
import { initialFormState, type FormActionState } from "@/components/app/action-result";

type FormAction = (prev: FormActionState, formData: FormData) => Promise<FormActionState>;

/** Toast an action result (FormActionState or ActionResult). */
export function toastResult(result: { ok?: boolean; message?: string; error?: string }) {
  if (result.ok) {
    if (result.message) toast.success(result.message);
  } else if (result.error) {
    toast.error(result.error);
  }
}

/**
 * useActionState plus a sonner toast for each result.
 *
 * - `formAction` for `<form action>`: React resets the inputs afterwards,
 *   which suits "add" forms (blackout, token, new form).
 * - `onSubmit` for edit forms: submits the same action without the reset, so
 *   a failed save keeps the owner's edits on screen.
 */
export function useToastAction(action: FormAction) {
  const [state, formAction, pending] = useActionState(async (prev: FormActionState, formData: FormData) => {
    const result = await action(prev, formData);
    toastResult(result);
    return result;
  }, initialFormState);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return { state, formAction, onSubmit, pending };
}
