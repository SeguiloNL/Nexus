#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*?)"?\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

function validateEmail(input) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof input === "string" && regex.test(input.trim());
}

const prisma = new PrismaClient();
const TEST_USERS = [
  { email: "admin@nexus.local", pw: "Test1234!" },
  { email: "medewerker@nexus.local", pw: "Test1234!" },
  { email: "viewer@nexus.local", pw: "Test1234!" },
];

// LoginSchema (identiek aan src/server/validators/user.ts)
const LoginSchema = z.object({
  email: z.string().trim().min(1, "E-mail verplicht").refine(validateEmail, "Ongeldig e-mailadres"),
  password: z.string().min(1, "Wachtwoord verplicht"),
});

console.log("=== CLI Login Debug ===");
console.log("DATABASE_URL:", process.env.DATABASE_URL?.split("@")[1] ?? "niet gezet");
console.log();

for (const { email, pw } of TEST_USERS) {
  console.log(`— User ${email} —`);

  const parsed = LoginSchema.safeParse({ email, password: pw });
  console.log("  LoginSchema:", parsed.success ? "✅ PASS" : `❌ FAIL ${JSON.stringify(parsed.error.flatten())}`);

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.log("  DB user: ❌ NIET GEVONDEN");
    console.log();
    continue;
  }
  console.log(`  DB user: ✅ GEVONDEN (id=${user.id.slice(0,8)}..., role=${user.role})`);
  console.log(`  passwordHash: ${user.passwordHash ? `✅ AANWEZIG (len=${user.passwordHash.length})` : "❌ LEEG"}`);

  if (user.passwordHash) {
    const ok = await bcrypt.compare(pw, user.passwordHash);
    console.log(`  verifyPassword: ${ok ? "✅ CORRECT" : "❌ FOUT"}`);
  }
  console.log();
}

await prisma.$disconnect();
console.log("=== Einde ===");
