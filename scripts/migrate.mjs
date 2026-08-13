/**
 * Apply Supabase migrations (00002 + 00003) to the remote project.
 *
 * Usage:
 *   node scripts/migrate.mjs              # paste instructions
 *   node scripts/migrate.mjs <pat>        # auto via Management API
 *
 * "pat" = your Supabase Personal Access Token
 * Create one: https://supabase.com/dashboard/account/tokens
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ref = "owdzbebuwwdgsiibybab";

const MIGRATIONS = [
  "00002_fix_rls_and_rpc.sql",
  "00003_safety_features.sql",
];

const pat = process.argv[2];

if (!pat) {
  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────────────┐");
  console.log("  │  Paste this SQL into Supabase Dashboard > SQL Editor       │");
  console.log("  │  https://supabase.com/dashboard/project/" + ref + "/sql/new       │");
  console.log("  └─────────────────────────────────────────────────────────────┘");
  console.log("");
  for (const file of MIGRATIONS) {
    const sql = readFileSync(resolve(__dirname, "..", "supabase", "migrations", file), "utf-8");
    console.log(`----- ${file} -----`);
    console.log(sql);
    console.log("");
  }
  console.log("");
  console.log("  Or run with a Personal Access Token for automatic migration:");
  console.log("  node scripts/migrate.mjs <your_supabase_pat>");
  process.exit(0);
}

async function main() {
  for (const file of MIGRATIONS) {
    const sql = readFileSync(resolve(__dirname, "..", "supabase", "migrations", file), "utf-8");
    const statements = sql
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`Applying ${file} (${statements.length} statements)...`);

    for (let i = 0; i < statements.length; i++) {
      process.stdout.write(`  [${i + 1}/${statements.length}] `);
      const resp = await fetch(
        `https://api.supabase.com/v1/projects/${ref}/database/query`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${pat}`,
          },
          body: JSON.stringify({ query: statements[i] }),
        }
      );
      if (resp.ok) {
        console.log("OK");
      } else {
        const err = await resp.text();
        console.log("ERR: " + err.slice(0, 150));
      }
    }
  }
  console.log("Migrations complete.");
}

main().catch(console.error);
