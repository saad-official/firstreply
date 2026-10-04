/**
 * What the Server Actions of the signed-in screens return to the UI. Errors
 * are messages that are safe to show; `upgradeUrl` is set when a plan limit
 * was hit, so the UI can link to /billing.
 */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; upgradeUrl?: string };

/** State for `useActionState` forms. */
export type FormActionState = { ok?: boolean; error?: string; upgradeUrl?: string; message?: string };

export const initialFormState: FormActionState = {};
