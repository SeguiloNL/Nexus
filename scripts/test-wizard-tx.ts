import pkg from "@prisma/client";
const { PrismaClient, UserRole } = pkg;

const prisma = new PrismaClient();

/**
 * CLI transactie-test: 6-stappen activatie (onafhankelijk van UI)
 * We draaien de transactionele activatie logica DIRECT via Prisma,
 * zodat we GEEN afhankelijkheid hebben van de @/ path alias of ESM extensies.
 *
 * Run: npx ts-node --esm --transpile-only scripts/test-wizard-tx.ts
 */
async function main() {
  console.log("=== Test Activation 6-stap transaction (via Prisma direct) ===\n");

  const admin = await prisma.user.findUnique({
    where: { email: "admin@nexus.local" },
    select: { id: true, role: true },
  });
  if (!admin) {
    console.error("Admin gebruiker admin@nexus.local niet gevonden. Draai eerst prisma db seed.");
    process.exit(1);
  }
  if (admin.role !== UserRole.ADMIN) {
    console.error("Test vereist ADMIN rol (security check uit services).");
    process.exit(1);
  }

  const customer = await prisma.customer.findFirst({ where: { deletedAt: null } });
  const product = await prisma.product.findFirst({ where: { isActive: true } });
  const tracker = await prisma.tracker.findFirst({
    where: { deletedAt: null, status: { in: ["IN_STOCK", "RESERVED"] } },
  });
  const sim = await prisma.sIM.findFirst({
    where: { deletedAt: null, status: { in: ["IN_STOCK", "RESERVED"] } },
  });
  const vehicle = customer
    ? await prisma.vehicle.findFirst({
        where: { deletedAt: null, customerId: customer.id },
      })
    : null;

  console.log("ADMIN:", admin.id, "(role:", admin.role + ")");
  console.log("Klant:", customer?.companyName ?? "—");
  console.log("Product:", product?.name, "€" + product?.monthlyPrice.toString());
  console.log("Tracker:", tracker?.serialNumber, "(was:", tracker?.status + ")");
  console.log("SIM:", sim?.iccid, "(was:", sim?.status + ")");
  console.log("Voertuig:", vehicle?.licensePlate ?? "(geen)");

  if (!customer || !product || !tracker || !sim) {
    console.error("Database mist demo data. Run eerst `npx prisma db seed`.");
    process.exit(1);
  }

  const desiredStartDate = new Date();
  const monthlyPrice = Number(product.monthlyPrice);

  // -------------------------------------------------------------------
  // STAP 1 & 2: Creëer order (DRAFT) → mark READY
  // -------------------------------------------------------------------
  console.log("\n[Step 1] Creëer DRAFT activation order");
  const orderNumber = `CLI-TEST-${Date.now()}`;
  const order1 = await prisma.activationOrder.create({
    data: {
      orderNumber,
      customerId: customer.id,
      productId: product.id,
      trackerId: tracker.id,
      simId: sim.id,
      vehicleId: vehicle?.id ?? null,
      desiredStartDate,
      monthlyPrice,
      billingCycle: "MONTHLY" as any,
      status: "DRAFT" as any,
      internalNotes: "[CLI test-wizard-tx.ts] DRAFT",
      createdById: admin.id,
    },
  });
  console.log("  DRAFT:", order1.orderNumber, "status =", order1.status);

  console.log("[Step 2] Markeer READY");
  const order2 = await prisma.activationOrder.update({
    where: { id: order1.id },
    data: {
      status: "READY" as any,
      internalNotes: "[CLI test-wizard-tx.ts] READY → zal PROCESSING → COMPLETED gaan via transaction",
    },
  });
  console.log("  READY:", order2.orderNumber, "status =", order2.status);

  // -------------------------------------------------------------------
  // STAP 3 t/m 6: 6-stappen transaction (Serializable isolatie)
  // Spiegel van activation-order.service.ts completeActivation()
  // -------------------------------------------------------------------
  console.log("\n[Step 3-6] Start 6-stappen $transaction (isolationLevel=Serializable)");
  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Lock order → PROCESSING
      const locked: any = await tx.activationOrder.findUnique({
        where: { id: order1.id },
        include: {
          customer: true,
          product: true,
          tracker: true,
          sim: true,
          vehicle: true,
        },
      });
      if (!locked) throw new Error("Order niet gevonden tijdens transaction");
      if (locked.status !== "READY" && locked.status !== "FAILED") {
        throw new Error(`Verkeerde status ${locked.status} (verwacht READY)`);
      }
      if (!locked.tracker || !locked.sim || !locked.customer || !locked.product) {
        throw new Error("Locked order ontbreekt assets");
      }
      await tx.activationOrder.update({
        where: { id: order1.id },
        data: { status: "PROCESSING" as any },
      });

      // 2-3. Re-check assets & geen active assignments
      const tLocked = await tx.tracker.findUnique({
        where: { id: locked.tracker.id, deletedAt: null },
      });
      if (!tLocked || (tLocked.status !== "IN_STOCK" && tLocked.status !== "RESERVED")) {
        throw new Error(`Tracker race: nu status = ${tLocked?.status ?? "deleted"}`);
      }
      const sLocked = await tx.sIM.findUnique({
        where: { id: locked.sim.id, deletedAt: null },
      });
      if (!sLocked || (sLocked.status !== "IN_STOCK" && sLocked.status !== "RESERVED")) {
        throw new Error(`SIM race: nu status = ${sLocked?.status ?? "deleted"}`);
      }
      const hasTA = await tx.trackerAssignment.findFirst({
        where: { trackerId: locked.tracker.id, endAt: null },
      });
      if (hasTA) throw new Error(`Tracker heeft reeds actieve assignment (partial unique)`);
      const hasSA = await tx.simAssignment.findFirst({
        where: { simId: locked.sim.id, endAt: null },
      });
      if (hasSA) throw new Error(`SIM heeft reeds actieve assignment (partial unique)`);

      // 4. Subscription PENDING → ACTIVE
      // (Geen auto-generation identifier helper hier; herhaal patroon)
      const year = desiredStartDate.getFullYear();
      const maxSub = await tx.subscription.aggregate({
        where: { subscriptionNumber: { startsWith: `SUB-CLI-${year}-` } },
        _max: { subscriptionNumber: true },
      });
      const seq = (maxSub?._max.subscriptionNumber
        ? parseInt(maxSub._max.subscriptionNumber.split("-").slice(-1)[0]!, 10) + 1
        : 1).toString().padStart(6, "0");
      const subNumber = `SUB-CLI-${year}-${seq}`;
      const sub = await tx.subscription.create({
        data: {
          subscriptionNumber: subNumber,
          customerId: locked.customerId,
          productId: locked.productId,
          startDate: locked.desiredStartDate,
          monthlyPrice: locked.monthlyPrice,
          billingCycle: locked.billingCycle,
          status: "PENDING_ACTIVATION" as any,
          notes: locked.internalNotes,
        },
      });
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: "ACTIVE" as any },
      });

      // 5. Asset statussen + assignments (partial unique index zorgt voor 1 actief)
      await tx.tracker.update({
        where: { id: locked.tracker.id },
        data: { status: "ACTIVE" as any },
      });
      await tx.sIM.update({
        where: { id: locked.sim.id },
        data: { status: "ACTIVE" as any },
      });

      await tx.trackerAssignment.create({
        data: {
          subscriptionId: sub.id,
          trackerId: locked.tracker.id,
          vehicleId: locked.vehicleId ?? null,
          startAt: new Date(),
          reason: "INITIAL" as any,
          createdById: admin.id,
        },
      });
      await tx.simAssignment.create({
        data: {
          subscriptionId: sub.id,
          simId: locked.sim.id,
          startAt: new Date(),
          reason: "INITIAL" as any,
          createdById: admin.id,
        },
      });

      // 6. Order COMPLETED
      const completed = await tx.activationOrder.update({
        where: { id: order1.id },
        data: {
          status: "COMPLETED" as any,
          subscriptionId: sub.id,
          completedAt: new Date(),
        },
      });

      return { order: completed, subscription: sub };
    },
    { isolationLevel: "Serializable" }
  );

  // -------------------------------------------------------------------
  // ASSERTIONS (als 1 van deze faalt, exit 1)
  // -------------------------------------------------------------------
  console.log("  COMMIT OK →", result.order.orderNumber, "status =", result.order.status);
  console.log("  Subscription:", result.subscription.subscriptionNumber, "status =", result.subscription.status);

  const finalOrder = await prisma.activationOrder.findUnique({ where: { id: result.order.id } });
  const finalSub = await prisma.subscription.findUnique({ where: { id: result.subscription.id } });
  const finalT = await prisma.tracker.findUnique({ where: { id: tracker.id } });
  const finalS = await prisma.sIM.findUnique({ where: { id: sim.id } });
  const tAssign = await prisma.trackerAssignment.findFirst({
    where: { trackerId: tracker.id, endAt: null },
  });
  const sAssign = await prisma.simAssignment.findFirst({
    where: { simId: sim.id, endAt: null },
  });

  console.log("");
  console.log("ASSERTIONS:");
  console.log("  Order.status COMPLETED:", finalOrder?.status === "COMPLETED" ? "OK" : "FAIL");
  console.log("  Sub.status ACTIVE:", finalSub?.status === "ACTIVE" ? "OK" : "FAIL");
  console.log("  Tracker.status ACTIVE:", finalT?.status === "ACTIVE" ? "OK" : "FAIL");
  console.log("  SIM.status ACTIVE:", finalS?.status === "ACTIVE" ? "OK" : "FAIL");
  console.log("  TrackerAssign endAt=null (actief):", tAssign ? "OK" : "MISSING");
  console.log("  SimAssign endAt=null (actief):", sAssign ? "OK" : "MISSING");
  console.log("  Order.subscriptionId gekoppeld:", finalOrder?.subscriptionId ? "OK" : "FAIL");
  console.log("  Order.completedAt set:", finalOrder?.completedAt ? "OK" : "FAIL");

  if (
    finalOrder?.status !== "COMPLETED" ||
    finalSub?.status !== "ACTIVE" ||
    finalT?.status !== "ACTIVE" ||
    finalS?.status !== "ACTIVE" ||
    !tAssign ||
    !sAssign ||
    !finalOrder?.subscriptionId ||
    !finalOrder?.completedAt
  ) {
    throw new Error("Assertion failed: 1 of meer statussen of foreign keys niet correct");
  }

  console.log("\n✅ Transaction smoke-test OK (6 stappen, Serializable, rollback-proof assertions).");
}

main()
  .catch((e) => {
    console.error("\n❌ ERROR:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
