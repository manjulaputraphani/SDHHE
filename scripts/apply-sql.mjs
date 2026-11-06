/**
 * Apply a .sql file to the Neon database (DATABASE_URL from .env or the shell).
 *
 *   node scripts/apply-sql.mjs drizzle/0006_team_chat.sql
 *
 * Safety: the script refuses to run a file that drops, truncates or deletes
 * anything unless --force is passed, so a migration cannot quietly wipe data.
 */
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

const file = process.argv[2];
const force = process.argv.includes("--force");

if (!file) {
  console.error("usage: node scripts/apply-sql.mjs <file.sql> [--force]");
  process.exit(1);
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set (.env or the environment)");
  process.exit(1);
}

const text = await readFile(file, "utf8");
const dangerous = /\b(drop\s+table|truncate|delete\s+from|drop\s+schema)\b/i.test(text);
if (dangerous && !force) {
  console.error(`Refusing to run ${file}: it drops or deletes data. Re-run with --force.`);
  process.exit(1);
}

/** Split a SQL file into single statements (the HTTP driver runs one at a time). */
function splitStatements(text) {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (const char of text) {
    current += char;
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === ";" && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed && trimmed !== ";") statements.push(trimmed);
      current = "";
    }
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const sql = neon(url);
try {
  const statements = splitStatements(text);
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`applied ${file} (${statements.length} statement(s))`);
} catch (err) {
  console.error(`failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
