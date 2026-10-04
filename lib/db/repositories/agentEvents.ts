import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../client";
import { agentEvents } from "../schema";
import type { AgentEvent } from "../types";
import { clampLimit } from "./shared";

/**
 * Read side of the append-only audit trail (writes go through
 * lib/ai/log.ts#logAgentEvent). Org-scoped.
 */

/** Newest first. */
export async function listForOrg(orgId: string, options: { limit?: number } = {}): Promise<AgentEvent[]> {
  const db = await getDb();
  return db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.orgId, orgId))
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(clampLimit(options.limit, 20, 200));
}

/** Events about one entity (a lead, a message), newest first. */
export async function listForEntity(
  orgId: string,
  entityType: string,
  entityId: string,
  options: { limit?: number } = {},
): Promise<AgentEvent[]> {
  const db = await getDb();
  return db
    .select()
    .from(agentEvents)
    .where(
      and(eq(agentEvents.orgId, orgId), eq(agentEvents.entityType, entityType), eq(agentEvents.entityId, entityId)),
    )
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(clampLimit(options.limit, 50, 200));
}
