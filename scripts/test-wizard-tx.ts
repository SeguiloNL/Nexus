import { PrismaClient } from "@prisma/client";
import { activateFromOrder, createActivationOrder, markOrderReady } from "../src/server/services/activation-order.service";

const prisma = new PrismaClient();

type Viewer = { id: string; role: "ADMIN" | "EMPLOYEE" | "VIEWER"; name: string; email: string };

async function main() {
  console.log("=== Test Activation 6-stap transaction ===\n");

  const customer = await prisma.customer.findFirst({ where: { deletedAt: null } });
  const product = await prisma.product.findFirst({ where: { isActive: true } });
  const tracker = await prisma.tracker.findFirst({ where: { deletedAt: null, status: "IN_STOCK" } });
  const sim = await prisma.sIM.findFirst({ where: { deletedAt: null, status: "IN_STOCK" } });
  const vehicle = customer ? await prisma.vehicle.findFirst({ where: { deletedAt: null, customerId: customer.id } }) : null;

  console.log("Customer:", customer?.companyName, customer?.id);
  console.log("Product:", product?.name, product?.id, "Price:", product?.monthlyPrice.toString());
  console.log("Tracker:", tracker?.serialNumber, tracker?.id, "Status:", tracker?.status);
  console.log("SIM:", sim?.iccid, sim?.id, "Status:", sim?.status);
  console.log("Vehicle:", vehicle?.licensePlate, vehicle?.id);

  if (!customer || !product || !tracker || !sim) {
    console.error("Missing required data in DB. Ensure seeds are present.");
    process.exit(1);
  }

  const viewer: Viewer = { id: "seed_admin", role: "ADMIN", name: "Administrator", email: "admin@seguilo.test" };

  console.log("\n=== Step 1: createActivationOrder (DRAFT) ===");
  const order1 = await createActivationOrder({
    customerId: customer.id,
    productId: product.id,
    desiredStartDate: new Date(),
    monthlyPrice: Number(product.monthlyPrice),
    billingCycle: "MONTHLY",
    trackerId: tracker.id,
    simId: sim.id,
    vehicleId: vehicle?.id ?? undefined,
  }, viewer);
  console.log("DRAFT Order:", order1.orderNumber, "Status:", order1.status);

  console.log("\n=== Step 2: markOrderReady (READY) ===");
  const order2 = await markOrderReady(order1.id, viewer);
  console.log("READY Order:", order2.status, "Subscription ID:", order2.subscriptionId);

  console.log("\n=== Steps 3-8: activateFromOrder (6stap transaction) ===");
  const [final] = await activateFromOrder(order1.id, viewer);
  console.log("COMPLETED Order:", final.status);
  console.log("  completedAt:", final.completedAt);
  console.log("  failedAt:", final.failedAt);

  const sub = await prisma.subscription.findUnique({ where: { id: final.subscriptionId! } });
  const tr = await prisma.tracker.findUnique({ where: { id: final.trackerId! } });
  const sm = await prisma.sIM.findUnique({ where: { id: final.simId! } });
  console.log("  Subscription.status:", sub?.status);
  console.log("  Tracker.status:", tr?.status);
  console.log("  SIM.status:", sm?.status);

  if (final.status !== "COMPLETED" || sub?.status !== "ACTIVE" || tr?.status !== "ASSIGNED" || sm?.status !== "ASSIGNED") {
    throw new Error("Status mismatch!");
  }

  console.log("\n✅ Transaction OK. All statuses correct.");
}

main()
  .catch((e) => { console.error("\n❌ ERROR:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
