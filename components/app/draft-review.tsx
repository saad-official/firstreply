"use client";

import { useId, useState, useTransition } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { approveDraft, editAndApproveDraft, rejectDraft } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ANSWER_PLACEHOLDER_TEXT } from "@/lib/services/queue-constants";
import type { ActionResult } from "./action-result";
import { FormMessage } from "./form-message";

/**
 * Approve / edit / reject one outbound draft. Starts in edit mode when the
 * draft still has the "[Write your answer here]" marker (a question only the
 * owner can answer). Lead text is shown as plain text, never HTML.
 */
export function DraftReview({
  messageId,
  subject,
  body,
  leadName,
}: {
  messageId: string;
  subject: string;
  body: string;
  leadName: string;
}) {
  const needsAnswer = body.includes(ANSWER_PLACEHOLDER_TEXT);
  const [editing, setEditing] = useState(needsAnswer);
  const [rejecting, setRejecting] = useState(false);
  const [draftSubject, setDraftSubject] = useState(subject);
  const [draftBody, setDraftBody] = useState(body);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const id = useId();

  const run = (kind: "approve" | "reject", action: () => Promise<ActionResult>) => {
    setError(null);
    setBusy(kind);
    startTransition(async () => {
      const result = await action();
      setBusy(null);
      if (result.ok) toast.success(result.message ?? "Done.");
      else {
        setError(result.error);
        setUpgradeUrl(result.upgradeUrl ?? null);
        toast.error(result.error);
      }
    });
  };

  const changed = draftSubject !== subject || draftBody !== body;

  return (
    <div className="grid gap-3">
      {editing ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-subject`}>Subject</Label>
            <Input
              id={`${id}-subject`}
              value={draftSubject}
              maxLength={200}
              onChange={(e) => setDraftSubject(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-body`}>Message to {leadName}</Label>
            <Textarea
              id={`${id}-body`}
              value={draftBody}
              rows={Math.min(18, Math.max(8, draftBody.split("\n").length + 1))}
              onChange={(e) => setDraftBody(e.target.value)}
              disabled={pending}
              className="font-sans text-sm leading-relaxed"
            />
            {needsAnswer && draftBody.includes(ANSWER_PLACEHOLDER_TEXT) ? (
              <p className="text-xs text-lemon-foreground dark:text-lemon">
                Replace {ANSWER_PLACEHOLDER_TEXT} with your answer before sending.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-semibold break-words">{subject || "(no subject)"}</p>
          <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground/90">{body}</p>
        </div>
      )}

      {rejecting ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-reason`}>Why reject it? (optional, improves the next draft)</Label>
          <Input
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            placeholder="e.g. too formal, do not mention the launch"
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
          />
        </div>
      ) : null}

      <FormMessage error={error} upgradeUrl={upgradeUrl} />

      <div className="flex flex-wrap items-center gap-2">
        {rejecting ? (
          <>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run("reject", () => rejectDraft({ messageId, reason }))}
            >
              {busy === "reject" ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
              Reject draft
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={pending}
              onClick={() =>
                run("approve", () =>
                  editing && changed
                    ? editAndApproveDraft({ messageId, subject: draftSubject, body: draftBody })
                    : approveDraft(messageId),
                )
              }
            >
              {busy === "approve" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              {editing && changed ? "Save and send" : "Approve and send"}
            </Button>
            {editing ? (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setDraftSubject(subject);
                  setDraftBody(body);
                  setEditing(needsAnswer);
                }}
              >
                {needsAnswer ? "Reset" : "Cancel edit"}
              </Button>
            ) : (
              <Button variant="outline" disabled={pending} onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Edit
              </Button>
            )}
            <Button variant="ghost" disabled={pending} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
