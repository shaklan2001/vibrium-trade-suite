import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let sql: Sql | null = null;

/** Lazy Neon client — safe at Next.js build time before DATABASE_URL exists. */
export function getSql(): Sql {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  sql = neon(url);
  return sql;
}
