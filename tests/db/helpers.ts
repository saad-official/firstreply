/**
 * Shared PGlite setup for database tests. Each test file calls `vi.mock("server-only")`
 * itself (vi.mock is hoisted per file), then `startTestDb()` in beforeAll.
 */
import type { SQL } from "drizzle-orm";
import { createPgliteDb, setDbHandle, type DbHandle } from "@/lib/db/client";
import { organizations } from "@/lib/db/schema";
import type { Organization } from "@/lib/db/types";

/** Fresh in-memory PGlite with every migration in drizzle/ applied, wired into getDb(). */
export async function startTestDb(): Promise<DbHandle> {
  const handle = await createPgliteDb(undefined);
  setDbHandle(handle);
  return handle;
}

export async function stopTestDb(handle: DbHandle | undefined): Promise<void> {
  setDbHandle(null);
  await handle?.close();
}

let orgCounter = 0;

export async function insertOrg(
  handle: DbHandle,
  values: Partial<typeof organizations.$inferInsert> = {},
): Promise<Organization> {
  orgCounter += 1;
  const slug = `test-co-${orgCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await handle.db
    .insert(organizations)
    .values({ name: "Test Co", slug, bookingSlug: slug, ...values })
    .returning();
  return org;
}

/** Raw SQL through the PGlite client (the driver-agnostic Db type leaves execute() results untyped). */
export async function queryRows<T>(handle: DbHandle, query: SQL): Promise<T[]> {
  const result = (await handle.db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

/** The Postgres error message behind a rejected query (Drizzle wraps it in `cause`). */
export async function dbErrorMessage(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(error);
  }
  throw new Error("expected the query to be rejected");
}
