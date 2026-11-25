import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Real SQLite constraints/triggers and transaction rollback, with the D1 binding
// interface. Miniflare's HTTP bridge cannot bind a port in restricted sandboxes.
export function createTestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrationDir = fileURLToPath(
    new URL("../../migrations/", import.meta.url),
  );
  for (const name of readdirSync(migrationDir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(`${migrationDir}/${name}`, "utf8"));
  }
  function prepare(
    sql: string,
    values: SQLInputValue[] = [],
  ): D1PreparedStatement {
    const statement = () => sqlite.prepare(sql);
    const result = <T>(results: T[] = [], changes = 0): D1Result<T> => ({
      success: true,
      results,
      meta: {
        duration: 0,
        changes,
        last_row_id: 0,
        changed_db: changes > 0,
        size_after: 0,
        rows_read: results.length,
        rows_written: changes,
      },
    });
    return {
      bind: (...args: unknown[]) => prepare(sql, args as SQLInputValue[]),
      async first<T>(column?: string) {
        const row = statement().get(...values);
        return (row ? (column ? row[column] : row) : null) as T | null;
      },
      async all<T>() {
        return result(statement().all(...values) as T[]);
      },
      async run<T>() {
        const stmt = statement();
        const rows = stmt.columns().length ? (stmt.all(...values) as T[]) : [];
        const changes = rows.length
          ? rows.length
          : stmt.columns().length
            ? 0
            : Number(stmt.run(...values).changes);
        return result(rows, changes);
      },
      async raw<T>(options?: { columnNames?: boolean }) {
        const stmt = statement();
        const names = stmt.columns().map((c) => c.name);
        const rows = stmt
          .all(...values)
          .map((row) => names.map((name) => row[name]));
        return (options?.columnNames ? [names, ...rows] : rows) as T[];
      },
    } as D1PreparedStatement;
  }
  const db: D1Database = {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results: D1Result<T>[] = [];
        for (const stmt of statements) results.push(await stmt.run<T>());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    async dump() {
      throw new Error("Not used by application");
    },
    withSession() {
      return { prepare, batch: db.batch.bind(db), getBookmark: () => null };
    },
  };
  return { db, sqlite, close: () => sqlite.close() };
}

export async function addUser(
  db: D1Database,
  id: string = crypto.randomUUID(),
  role: "user" | "admin" = "user",
) {
  await db
    .prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
    )
    .bind(id, id, `${id}@example.com`, Date.now(), Date.now())
    .run();
  if (role === "admin")
    await db
      .prepare("UPDATE profiles SET role = 'admin' WHERE id = ?")
      .bind(id)
      .run();
  return { id, email: `${id}@example.com`, emailVerified: true, role };
}

export async function addSpot(
  db: D1Database,
  actorId: string,
  overrides: Record<string, unknown> = {},
) {
  const id = crypto.randomUUID();
  const row = {
    id,
    name: "River park",
    slug: `park-${id}`,
    kind: "outdoor",
    lat: 42.9634,
    lng: -85.6681,
    created_by: actorId,
    ...overrides,
  };
  const keys = Object.keys(row);
  await db
    .prepare(
      `INSERT INTO spots (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    )
    .bind(...Object.values(row))
    .run();
  return row;
}
