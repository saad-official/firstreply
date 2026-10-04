import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../client";
import { webhookTokens } from "../schema";
import type { WebhookToken } from "../types";
import { isUniqueViolation, randomUrlSafeId } from "./shared";

/** 32 url-safe characters (192 bits): the token is the credential for /api/leads/webhook/<token>. */
const TOKEN_LENGTH = 32;

export async function create(orgId: string, input: { sourceLabel?: string } = {}): Promise<WebhookToken> {
  const sourceLabel = input.sourceLabel?.trim().slice(0, 80) || "Webhook";
  const db = await getDb();
  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = await db
        .insert(webhookTokens)
        .values({ orgId, token: randomUrlSafeId(TOKEN_LENGTH), sourceLabel })
        .returning();
      return row;
    } catch (error) {
      if (attempt < 3 && isUniqueViolation(error, "webhook_tokens_token_unique")) continue;
      throw error;
    }
  }
}

/**
 * Public intake lookup: the active (not revoked) token, or null. Not
 * org-scoped; the token identifies the org. Stamps last_used_at unless
 * `touch: false`.
 */
export async function getByToken(
  token: string,
  options: { touch?: boolean; now?: Date } = {},
): Promise<WebhookToken | null> {
  if (!token || token.length > 128) return null;
  const db = await getDb();
  const where = and(eq(webhookTokens.token, token), isNull(webhookTokens.revokedAt));
  if (options.touch === false) {
    const [row] = await db.select().from(webhookTokens).where(where).limit(1);
    return row ?? null;
  }
  const [row] = await db
    .update(webhookTokens)
    .set({ lastUsedAt: options.now ?? new Date() })
    .where(where)
    .returning();
  return row ?? null;
}

/** Active and revoked tokens, newest first. */
export async function listForOrg(orgId: string): Promise<WebhookToken[]> {
  const db = await getDb();
  return db
    .select()
    .from(webhookTokens)
    .where(eq(webhookTokens.orgId, orgId))
    .orderBy(desc(webhookTokens.createdAt));
}

/** Soft revoke (the row stays for the audit trail). False when unknown or already revoked. */
export async function revoke(orgId: string, tokenId: string, now: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(webhookTokens)
    .set({ revokedAt: now })
    .where(and(eq(webhookTokens.id, tokenId), eq(webhookTokens.orgId, orgId), isNull(webhookTokens.revokedAt)))
    .returning({ id: webhookTokens.id });
  return rows.length > 0;
}
