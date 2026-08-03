import { drizzle } from "drizzle-orm/d1";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

type RunnableQuery = { run(): unknown };
type NodeDatabase = ReturnType<typeof drizzleSqlite> & {
  batch(queries: RunnableQuery[]): Promise<unknown[]>;
};

let nodeDatabase: NodeDatabase | null = null;

export async function getDb() {
  const nodeDatabasePath = process.env.NODE_DATABASE_PATH;
  if (nodeDatabasePath) {
    if (!nodeDatabase) {
      const { dirname } = await import("node:path");
      const { mkdir } = await import("node:fs/promises");
      const packageName = "better-sqlite3";
      const { default: Database } = await import(/* @vite-ignore */ packageName);
      await mkdir(dirname(nodeDatabasePath), { recursive: true });
      const sqlite = new Database(nodeDatabasePath);
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("foreign_keys = ON");
      const database = drizzleSqlite(sqlite, { schema });
      const runTransaction = sqlite.transaction((queries: RunnableQuery[]) =>
        queries.map((query) => query.run())
      );
      nodeDatabase = Object.assign(database, {
        async batch(queries: RunnableQuery[]) {
          return runTransaction(queries);
        },
      });
    }
    return nodeDatabase;
  }

  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
