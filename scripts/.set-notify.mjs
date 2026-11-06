import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config();
const sql = neon(process.env.DATABASE_URL);
await sql.query("insert into settings (key, value) values ('notify_emails', $1) on conflict (key) do update set value = excluded.value", ["local@test.local"]);
console.log("notify_emails set (local test)");
