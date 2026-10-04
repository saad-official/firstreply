import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DbHandle } from "@/lib/db/client";
import * as leadsRepo from "@/lib/db/repositories/leads";
import * as messagesRepo from "@/lib/db/repositories/messages";
import * as outboxRepo from "@/lib/db/repositories/outbox";
import * as slotOffersRepo from "@/lib/db/repositories/slotOffers";
import { ingestLead, processLead } from "@/lib/services/intake";
import { refreshStaleDrafts, replaceSlotLines, retryFailedOutbox } from "@/lib/services/maintenance";
import { approveMessage } from "@/lib/services/sending";
import { insertOrg, startTestDb, stopTestDb } from "../db/helpers";
import { makeDeps, openEveryDay } from "./helpers";

let handle: DbHandle;

beforeAll(async () => {
  handle = await startTestDb();
}, 120_000);

afterAll(async () => {
  await stopTestDb(handle);
});

const MESSAGE =
  "We are a 40-person software company planning a full website redesign before our spring launch. Could we talk about scope and timing next week?";
const DAY = 86_400_000;

describe("replaceSlotLines", () => {
  it("swaps every slot line or refuses when one was edited away", () => {
    expect(replaceSlotLines("- A\n- B", ["A", "B"], ["C", "D"])).toBe("- C\n- D");
    expect(replaceSlotLines("- A\n- edited", ["A", "B"], ["C", "D"])).toBeNull();
  });
});

describe("daily maintenance", () => {
  it("refreshes a waiting draft whose offered times went stale", async () => {
    const org = await insertOrg(handle, { timezone: "Europe/London" });
    await openEveryDay(org.id);
    const deps = makeDeps();
    const { lead } = await ingestLead(org.id, { email: "a@acme.example", name: "Ann", message: MESSAGE, source: "form" });
    const processed = await processLead(org.id, lead.id, {}, deps);
    if (processed.status !== "processed") throw new Error("not processed");
    const before = await slotOffersRepo.listForMessage(org.id, processed.messageId!);

    // Nothing is stale today.
    expect((await refreshStaleDrafts(new Date())).refreshed).toBe(0);

    // A week later every offered time is in the past.
    const later = new Date(Date.now() + 7 * DAY);
    const result = await refreshStaleDrafts(later);
    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    const after = await slotOffersRepo.listForMessage(org.id, processed.messageId!);
    expect(after).toHaveLength(before.length);
    expect(after.every((o) => o.startsAt.getTime() > later.getTime())).toBe(true);
    const draft = await messagesRepo.getById(org.id, processed.messageId!);
    expect(draft?.body).not.toBe("");
  });

  it("retries a failed delivery and marks the message sent", async () => {
    const org = await insertOrg(handle, { timezone: "Europe/London" });
    await openEveryDay(org.id);
    const deps = makeDeps();
    const { lead } = await ingestLead(org.id, { email: "b@acme.example", name: "Ben", message: MESSAGE, source: "form" });
    const processed = await processLead(org.id, lead.id, {}, deps);
    if (processed.status !== "processed") throw new Error("not processed");

    deps.emailProvider.failNext = 1;
    const first = await approveMessage(org.id, processed.messageId!, null, deps);
    expect(first.send.status).toBe("failed");
    expect((await messagesRepo.getById(org.id, processed.messageId!))?.status).toBe("approved");
    expect((await outboxRepo.listForOrg(org.id))[0].status).toBe("failed");

    const retry = await retryFailedOutbox(new Date(), deps);
    expect(retry.resent).toBe(1);
    expect((await messagesRepo.getById(org.id, processed.messageId!))?.status).toBe("sent");
    expect((await leadsRepo.getById(org.id, lead.id))?.status).toBe("replied");
    expect(deps.emailProvider.sent).toHaveLength(1);
  });

  it("purges leads past retention but keeps recent ones", async () => {
    const org = await insertOrg(handle);
    const old = await leadsRepo.create(org.id, {
      source: "form",
      email: "old@acme.example",
      message: "old",
      createdAt: new Date(Date.now() - 400 * DAY),
    });
    const recent = await leadsRepo.create(org.id, { source: "form", email: "new@acme.example", message: "new" });
    const purged = await leadsRepo.purgeOlderThan(new Date(Date.now() - 180 * DAY));
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await leadsRepo.getById(org.id, old.id)).toBeNull();
    expect(await leadsRepo.getById(org.id, recent.id)).not.toBeNull();
  });
});
