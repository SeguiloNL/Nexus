import { saveInserveSettings, getInserveSettingsMasked } from "./src/server/services/app-setting.service";
import { prisma } from "./src/lib/prisma";

async function main() {
  const userId = "clx_admin_user_id";
  const userRole = "ADMIN";
  const ctx = { userId, userRole };

  console.log("\n=== Before save ===");
  console.log(await getInserveSettingsMasked());

  console.log("\n=== Saving test settings ===");
  const saved = await saveInserveSettings(
    { subdomain: "test-nexus-koppeling", apiKey: "inserve_test_api_key_abcdef12345" },
    ctx
  );
  console.log("Saved subdomain:", saved.subdomain, "keyLen:", saved.apiKey.length);

  console.log("\n=== After save (masked) ===");
  console.log(await getInserveSettingsMasked());

  console.log("\n=== Raw DB rows ===");
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "inserve." } }, select: { key: true, value: false, isSecret: true, updatedAt: true, id: true } });
  console.log(rows);

  console.log("\n=== Audit log entry ===");
  const log = await prisma.auditLog.findFirst({ where: { action: "UPDATE_SETTINGS" }, orderBy: { timestamp: "desc" }, take: 1, select: { action: true, oldValues: true, newValues: true, metadata: true } });
  console.log(log);
}

main().finally(() => prisma.$disconnect());
