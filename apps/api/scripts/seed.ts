/**
 * Seed script (runs with Node's built-in TypeScript support: `node scripts/seed.ts`).
 *
 *   node scripts/seed.ts --local --dev-data
 *       Local dev: super admin + a pilot center with a manager and a receptionist.
 *
 *   SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... node scripts/seed.ts --env production
 *       Remote: creates only the super admin account.
 *
 *   SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... node scripts/seed.ts --env staging --pilot-center
 *       Remote test site: also the pilot center with a manager and a receptionist
 *       (SEED_MANAGER_EMAIL / SEED_RECEPTION_EMAIL), who get one-time passwords to change at first sign-in.
 *
 * Passwords are hashed here; only hashes reach the database.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TEMPLATES } from "../src/domain/default-templates.ts";
import { hashPassword } from "../src/lib/password.ts";
import { randomToken } from "../src/lib/tokens.ts";

const args = process.argv.slice(2);
const local = args.includes("--local");
const devData = args.includes("--dev-data");
const pilotCenter = devData || args.includes("--pilot-center");
const envIdx = args.indexOf("--env");
const env = envIdx >= 0 ? args[envIdx + 1] : undefined;
if (!local && !env) {
  console.error("Use --local, or --env staging|production");
  process.exit(1);
}
if (devData && !local) {
  console.error("--dev-data is only allowed with --local");
  process.exit(1);
}

const q = (v: string | null) => (v === null ? "NULL" : `'${v.replaceAll("'", "''")}'`);
const now = Date.now();
const lines: string[] = [];
const printed: string[] = [];

async function addUser(u: { email: string; name: string; role: string; centerId: string | null; password?: string }) {
  const password = u.password ?? randomToken(12);
  const hash = await hashPassword(password);
  // Online, generated passwords are one-time: the person chooses their own at first sign-in.
  const mustChange = !local && !u.password ? 1 : 0;
  lines.push(
    `INSERT INTO users (id, center_id, name, email, password_hash, role, preferred_locale, is_active, must_change_password, created_at, updated_at)
     VALUES (${q(crypto.randomUUID())}, ${q(u.centerId)}, ${q(u.name)}, ${q(u.email.toLowerCase())}, ${q(hash)}, ${q(u.role)}, 'ar', 1, ${mustChange}, ${now}, ${now})
     ON CONFLICT(email) DO NOTHING;`,
  );
  if (!u.password) printed.push(`${u.role.padEnd(13)} ${u.email}  password: ${password}`);
}

const superEmail = process.env.SEED_SUPERADMIN_EMAIL ?? (local ? "admin@local.test" : undefined);
const superPassword = process.env.SEED_SUPERADMIN_PASSWORD;
if (!superEmail) {
  console.error("Set SEED_SUPERADMIN_EMAIL (and SEED_SUPERADMIN_PASSWORD) for remote seeding");
  process.exit(1);
}
if (!local && (!superPassword || superPassword.length < 12)) {
  console.error("SEED_SUPERADMIN_PASSWORD must be at least 12 characters for remote seeding");
  process.exit(1);
}
await addUser({ email: superEmail, name: "Platform Admin", role: "super_admin", centerId: null, password: superPassword });

if (pilotCenter) {
  const centerId = "00000000-0000-4000-8000-000000000001";
  lines.push(
    `INSERT INTO centers (id, slug, status, name_ar, name_en, phone, whatsapp_phone, timezone, default_country_code, currency, default_locale, slot_step_minutes, min_lead_minutes, max_advance_days, created_at, updated_at)
     VALUES (${q(centerId)}, 'pilot', 'active', 'المركز الطبي التخصصي', 'Specialty Medical Center', '+963110000000', '+963940000000', 'Asia/Damascus', '963', 'SYP', 'ar', 10, 120, 30, ${now}, ${now})
     ON CONFLICT(id) DO NOTHING;`,
  );
  for (const [key, body] of Object.entries(DEFAULT_TEMPLATES)) {
    lines.push(
      `INSERT INTO message_templates (id, center_id, key, body_ar, body_en, updated_at)
       VALUES (${q(crypto.randomUUID())}, ${q(centerId)}, ${q(key)}, ${q(body.ar)}, ${q(body.en)}, ${now})
       ON CONFLICT(center_id, key) DO NOTHING;`,
    );
  }
  const managerEmail = process.env.SEED_MANAGER_EMAIL ?? "manager@local.test";
  const receptionEmail = process.env.SEED_RECEPTION_EMAIL ?? "reception@local.test";
  await addUser({ email: managerEmail, name: "Center Manager", role: "manager", centerId });
  await addUser({ email: receptionEmail, name: "Reception", role: "receptionist", centerId });
}

const dir = mkdtempSync(join(tmpdir(), "mc-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, lines.join("\n"));
const target = local ? ["--local"] : ["--remote", "--env", env!];
execFileSync("npx", ["wrangler", "d1", "execute", "DB", ...target, "--file", file, "-y"], { stdio: "inherit" });

console.log("\nSeeded. New accounts (existing emails were left unchanged):");
for (const line of printed) console.log("  " + line);
if (superPassword) console.log(`  super_admin   ${superEmail}  (password from SEED_SUPERADMIN_PASSWORD)`);
