import bcrypt from "bcryptjs";
import pkg from "@prisma/client";
const {
  Prisma,
  PrismaClient,
  UserRole,
  CustomerStatus,
  TrackerStatus,
  SimStatus,
  SubscriptionStatus,
  BillingCycle,
  ActivationOrderStatus,
  AssignmentReason,
} = pkg;

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

const PASSWORD = "Test1234!";

async function main() {
  console.log("🌱 Seeding Nexus development database...");

  const pwd = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

  const admin = await prisma.user.upsert({
    where: { email: "admin@nexus.local" },
    update: {},
    create: {
      email: "admin@nexus.local",
      name: "Administrator",
      passwordHash: pwd,
      role: UserRole.ADMIN,
    },
  });
  console.log(`  ✅ ADMIN: ${admin.email} / ${PASSWORD}`);

  const employee = await prisma.user.upsert({
    where: { email: "medewerker@nexus.local" },
    update: {},
    create: {
      email: "medewerker@nexus.local",
      name: "Medewerker Nexus",
      passwordHash: pwd,
      role: UserRole.EMPLOYEE,
    },
  });
  console.log(`  ✅ EMPLOYEE: ${employee.email} / ${PASSWORD}`);

  const viewer = await prisma.user.upsert({
    where: { email: "viewer@nexus.local" },
    update: {},
    create: {
      email: "viewer@nexus.local",
      name: "Viewer Account",
      passwordHash: pwd,
      role: UserRole.VIEWER,
    },
  });
  console.log(`  ✅ VIEWER: ${viewer.email} / ${PASSWORD}`);

  const demoCustomer = await prisma.customer.upsert({
    where: { customerNumber: "C-2025-0001" },
    update: {},
    create: {
      customerNumber: "C-2025-0001",
      companyName: "Van der Transport B.V.",
      status: CustomerStatus.ACTIVE,
      contactPerson: "Piet van der Transport",
      email: "info@vandertransport.test",
      phone: "+31612345678",
      address: "Hoofdstraat 12",
      postalCode: "1234 AB",
      city: "Amsterdam",
      country: "NL",
      notes: "Seed demo-klant. Transport en logistiek.",
    },
  });
  console.log(`  ✅ CUSTOMER: ${demoCustomer.companyName}`);

  const prodBasic = await prisma.product.upsert({
    where: { productCode: "TRK-BASIC" },
    update: {},
    create: {
      productCode: "TRK-BASIC",
      name: "Basic Tracking",
      description:
        "Standaard voertuig volgen met elke 3 minuten een positie update en dagelijkse rapportages.",
      monthlyPrice: new Prisma.Decimal("9.95"),
      currency: "EUR",
      isActive: true,
    },
  });

  const prodPro = await prisma.product.upsert({
    where: { productCode: "TRK-PRO" },
    update: {},
    create: {
      productCode: "TRK-PRO",
      name: "Pro Tracking",
      description:
        "Geavanceerd volgen met 30 seconde interval, rijgedrag rapportages en geofencing alerts.",
      monthlyPrice: new Prisma.Decimal("19.95"),
      currency: "EUR",
      isActive: true,
    },
  });

  const prodPremium = await prisma.product.upsert({
    where: { productCode: "TRK-PREMIUM" },
    update: {},
    create: {
      productCode: "TRK-PREMIUM",
      name: "Premium Fleet",
      description:
        "Compleet fleet management pakket met API toegang, SLA 99.9% en dedicated support.",
      monthlyPrice: new Prisma.Decimal("49.00"),
      currency: "EUR",
      isActive: true,
    },
  });
  console.log(
    `  ✅ PRODUCTS: ${prodBasic.name}, ${prodPro.name}, ${prodPremium.name}`
  );

  const tracker1 = await prisma.tracker.upsert({
    where: { serialNumber: "TRK-00001-ST" },
    update: {},
    create: {
      serialNumber: "TRK-00001-ST",
      imei: "490154203237518",
      brand: "Teltonika",
      model: "FMB920",
      status: TrackerStatus.IN_STOCK,
      notes: "Op voorraad, demo-ready.",
    },
  });

  const tracker2 = await prisma.tracker.upsert({
    where: { serialNumber: "TRK-00002-ST" },
    update: {},
    create: {
      serialNumber: "TRK-00002-ST",
      imei: "490154203237526",
      brand: "Teltonika",
      model: "FMB001",
      status: TrackerStatus.IN_STOCK,
    },
  });
  console.log(
    `  ✅ TRACKERS IN STOCK: ${tracker1.serialNumber}, ${tracker2.serialNumber}`
  );

  const sim1 = await prisma.sIM.upsert({
    where: { iccid: "8931041012345678901" },
    update: {},
    create: {
      iccid: "8931041012345678901",
      imsi: "204081234567890",
      msisdn: "31681234567",
      provider: "KPN IoT",
      simType: "M2M",
      status: SimStatus.IN_STOCK,
    },
  });

  const sim2 = await prisma.sIM.upsert({
    where: { iccid: "8931041012345678902" },
    update: {},
    create: {
      iccid: "8931041012345678902",
      imsi: "204081234567891",
      msisdn: "31681234568",
      provider: "KPN IoT",
      simType: "M2M",
      status: SimStatus.IN_STOCK,
    },
  });
  console.log(`  ✅ SIMS IN STOCK: ${sim1.iccid}, ${sim2.iccid}`);

  const v1 = await prisma.vehicle.upsert({
    where: { licensePlate: "AB-01-CD" },
    update: {},
    create: {
      customerId: demoCustomer.id,
      licensePlate: "AB-01-CD",
      vin: "WVWZZZ3CZWE123456",
      brand: "Volkswagen",
      model: "Crafter L3H3",
      description: "Bestelbus, Euro 6, 2024, 90.000 km",
      notes: "Eerste volgsysteem demo voertuig.",
    },
  });

  const v2 = await prisma.vehicle.upsert({
    where: { licensePlate: "EF-23-GH" },
    update: {},
    create: {
      customerId: demoCustomer.id,
      licensePlate: "EF-23-GH",
      vin: "VF1VF000051234567",
      brand: "Renault",
      model: "Master",
      description: "Koelwagen -18°C, bouwjaar 2022",
    },
  });
  console.log(
    `  ✅ VEHICLES: ${v1.licensePlate}, ${v2.licensePlate} (${demoCustomer.companyName})`
  );

  // ============================================================
  // TASK 18 – Uitgebreide demo data: extra klanten, trackers,
  // SIMs, voertuigen + VOORINGEVULDE abonnementen/activaties
  // zodat Dashboard Recente activaties nooit leeg is.
  // ============================================================

  const customerKpn = await prisma.customer.upsert({
    where: { customerNumber: "C-2025-0002" },
    update: {},
    create: {
      customerNumber: "C-2025-0002",
      companyName: "KPN M2M Services B.V.",
      status: CustomerStatus.ACTIVE,
      contactPerson: "Marieke de Boer",
      email: "marieke.deboer@kpn-m2m.test",
      phone: "+31622334455",
      address: "De Ruyterkade 136",
      postalCode: "1011AA",
      city: "Amsterdam",
      country: "NL",
      notes: "Enterprise M2M/MTDM klant. 100+ SIMs in beheer.",
    },
  });

  const customerBakkerij = await prisma.customer.upsert({
    where: { customerNumber: "C-2025-0003" },
    update: {},
    create: {
      customerNumber: "C-2025-0003",
      companyName: "Bakkerij de Vries B.V.",
      status: CustomerStatus.ACTIVE,
      contactPerson: "Jan de Vries",
      email: "info@bakkerijdevries.test",
      phone: "+31644556677",
      address: "Bakkerstraat 42",
      postalCode: "7891CD",
      city: "Groningen",
      country: "NL",
      notes: "Bezorgwagens stallen, wisselend aantal voertuigen per seizoen.",
    },
  });
  console.log(`  ✅ EXTRA CUSTOMERS: ${customerKpn.companyName}, ${customerBakkerij.companyName}`);

  const v3 = await prisma.vehicle.upsert({
    where: { licensePlate: "KP-01-NL" },
    update: {},
    create: {
      customerId: customerKpn.id,
      licensePlate: "KP-01-NL",
      vin: "WF0XXXGCDX5M12345",
      brand: "Ford",
      model: "Transit Custom",
      description: "KPN Monteursbus, bouwjaar 2023",
    },
  });

  const v4 = await prisma.vehicle.upsert({
    where: { licensePlate: "BV-02-DR" },
    update: {},
    create: {
      customerId: customerBakkerij.id,
      licensePlate: "BV-02-DR",
      vin: "MB90133312R987654",
      brand: "Mercedes-Benz",
      model: "Sprinter 315 CDI",
      description: "Bezorgbus warmhoudruimte (brood/beleg)",
    },
  });
  console.log(`  ✅ EXTRA VEHICLES: ${v3.licensePlate} (KPN), ${v4.licensePlate} (Bakkerij)`);

  const tracker3 = await prisma.tracker.upsert({
    where: { serialNumber: "TRK-00003-ST" },
    update: {},
    create: {
      serialNumber: "TRK-00003-ST",
      imei: "861882037421951",
      brand: "Queclink",
      model: "GV500",
      status: TrackerStatus.IN_STOCK,
      notes: "4G + backup 2G, demo-ready",
    },
  });

  const tracker4 = await prisma.tracker.upsert({
    where: { serialNumber: "TRK-00004-ST" },
    update: {},
    create: {
      serialNumber: "TRK-00004-ST",
      imei: "863844258880012",
      brand: "Teltonika",
      model: "FMC920",
      status: TrackerStatus.RESERVED,
      notes: "Gereserveerd voor Bakkerij de Vries (nog niet geactiveerd)",
    },
  });
  console.log(`  ✅ EXTRA TRACKERS: ${tracker3.serialNumber} (IN_STOCK), ${tracker4.serialNumber} (RESERVED)`);

  const sim3 = await prisma.sIM.upsert({
    where: { iccid: "8931041012345678903" },
    update: {},
    create: {
      iccid: "8931041012345678903",
      imsi: "204081234567892",
      msisdn: "31681234569",
      provider: "KPN IoT",
      simType: "M2M",
      status: SimStatus.IN_STOCK,
    },
  });

  const sim4 = await prisma.sIM.upsert({
    where: { iccid: "8931041012345678904" },
    update: {},
    create: {
      iccid: "8931041012345678904",
      imsi: "204081234567893",
      msisdn: "31681234570",
      provider: "KPN IoT",
      simType: "M2M",
      status: SimStatus.RESERVED,
      notes: "Gereserveerd t.b.v. KPN M2M migratie-traject",
    },
  });
  console.log(`  ✅ EXTRA SIMS: ${sim3.iccid} (IN_STOCK), ${sim4.iccid} (RESERVED)`);

  // =================================================================
  // VOORINGEVULDE ACTIVE SUBSCRIPTION + COMPLETED ACTIVATION ORDER
  // Zodat Dashboard Recente activaties & stats niet leeg zijn.
  // =================================================================

  const demoStartDate = new Date("2025-11-01T00:00:00Z");
  const demoCompletedAt = new Date("2025-10-31T14:22:09Z");

  const demoSubscription = await prisma.subscription.upsert({
    where: { subscriptionNumber: "SUB-2025-000001" },
    update: {},
    create: {
      subscriptionNumber: "SUB-2025-000001",
      customerId: customerKpn.id,
      productId: prodPremium.id,
      status: SubscriptionStatus.ACTIVE,
      startDate: demoStartDate,
      monthlyPrice: new Prisma.Decimal("49.00"),
      billingCycle: BillingCycle.MONTHLY,
      notes: "Uitgebreide demo Premium Fleet, KPN M2M Services.",
    },
  });

  // Markeer tracker 3 en sim 3 ACTIVE + active assignments
  await prisma.tracker.update({
    where: { id: tracker3.id },
    data: { status: TrackerStatus.ACTIVE },
  });
  await prisma.sIM.update({
    where: { id: sim3.id },
    data: { status: SimStatus.ACTIVE },
  });

  const trackerAssign1 = await prisma.trackerAssignment.upsert({
    where: { id: `tassign-${tracker3.id}-seed` },
    update: {},
    create: {
      id: `tassign-${tracker3.id}-seed`,
      trackerId: tracker3.id,
      subscriptionId: demoSubscription.id,
      vehicleId: v3.id,
      startAt: demoStartDate,
      reason: AssignmentReason.INITIAL,
      createdById: admin.id,
    },
  });

  const simAssign1 = await prisma.simAssignment.upsert({
    where: { id: `sassign-${sim3.id}-seed` },
    update: {},
    create: {
      id: `sassign-${sim3.id}-seed`,
      simId: sim3.id,
      subscriptionId: demoSubscription.id,
      startAt: demoStartDate,
      reason: AssignmentReason.INITIAL,
      createdById: admin.id,
    },
  });

  const completedOrder = await prisma.activationOrder.upsert({
    where: { orderNumber: "ACT-2025-000001" },
    update: {},
    create: {
      orderNumber: "ACT-2025-000001",
      customerId: customerKpn.id,
      productId: prodPremium.id,
      trackerId: tracker3.id,
      simId: sim3.id,
      vehicleId: v3.id,
      subscriptionId: demoSubscription.id,
      status: ActivationOrderStatus.COMPLETED,
      monthlyPrice: new Prisma.Decimal("49.00"),
      desiredStartDate: demoStartDate,
      internalNotes:
        "Seed demo: eerste succesvolle Premium Fleet activatie bij KPN M2M Services.",
      completedAt: demoCompletedAt,
      createdById: admin.id,
    },
  });
  console.log(
    `  ✅ DEMO ACTIVE FLOW: order ${completedOrder.orderNumber} → subscription ${demoSubscription.subscriptionNumber} (${demoSubscription.status}, €${demoSubscription.monthlyPrice}/mnd)`
  );
  console.log(
    `     Tracker ${tracker3.serialNumber} + SIM …${sim3.iccid.slice(-3)} toegewezen (assignments: ${trackerAssign1.id}, ${simAssign1.id})`
  );

  // =================================================================
  // SUSPENDED subscription als voorbeeld van andere status.
  // =================================================================

  const suspendedStart = new Date("2025-09-15T00:00:00Z");
  const suspendedAt = new Date("2026-02-10T11:03:41Z");

  const suspendedSub = await prisma.subscription.upsert({
    where: { subscriptionNumber: "SUB-2025-000002" },
    update: {},
    create: {
      subscriptionNumber: "SUB-2025-000002",
      customerId: customerBakkerij.id,
      productId: prodBasic.id,
      status: SubscriptionStatus.SUSPENDED,
      startDate: suspendedStart,
      monthlyPrice: new Prisma.Decimal("9.95"),
      billingCycle: BillingCycle.MONTHLY,
      notes:
        "Bakkerij de Vries - seizoenabonnement, opgeschort. Reden: Seizoensstop koude oven, geen bezorging februari.",
    },
  });

  const trackerSusp = await prisma.tracker.upsert({
    where: { serialNumber: "TRK-00005-ST" },
    update: {},
    create: {
      serialNumber: "TRK-00005-ST",
      imei: "490154203237600",
      brand: "Teltonika",
      model: "FMB920",
      status: TrackerStatus.SUSPENDED,
      notes: "Seed: gekoppeld aan SUSPENDED sub Bakkerij de Vries",
    },
  });

  const simSusp = await prisma.sIM.upsert({
    where: { iccid: "8931041012345678905" },
    update: {},
    create: {
      iccid: "8931041012345678905",
      imsi: "204081234567894",
      msisdn: "31681234571",
      provider: "KPN IoT",
      simType: "M2M",
      status: SimStatus.SUSPENDED,
    },
  });

  await prisma.trackerAssignment.upsert({
    where: { id: `tassign-${trackerSusp.id}-seed` },
    update: {},
    create: {
      id: `tassign-${trackerSusp.id}-seed`,
      trackerId: trackerSusp.id,
      subscriptionId: suspendedSub.id,
      vehicleId: v4.id,
      startAt: suspendedStart,
      endAt: suspendedAt,
      reason: AssignmentReason.INITIAL,
      createdById: admin.id,
    },
  });
  await prisma.simAssignment.upsert({
    where: { id: `sassign-${simSusp.id}-seed` },
    update: {},
    create: {
      id: `sassign-${simSusp.id}-seed`,
      simId: simSusp.id,
      subscriptionId: suspendedSub.id,
      startAt: suspendedStart,
      endAt: suspendedAt,
      reason: AssignmentReason.INITIAL,
      createdById: admin.id,
    },
  });
  console.log(
    `  ✅ DEMO SUSPENDED FLOW: subscription ${suspendedSub.subscriptionNumber} (status SUSPENDED, zie notes voor seizoenstop-reden)`
  );
  console.log(
    `     Koppeling: tracker ${trackerSusp.serialNumber} + SIM …${simSusp.iccid.slice(-3)} (beide SUSPENDED, assignments endDate = ${suspendedAt.toISOString()})`
  );

  console.log("🌱 Seeding klaar (incl. uitgebreide demo data voor Dashboard).");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
