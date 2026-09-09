import bcrypt from "bcryptjs";
import pkg from "@prisma/client";
const {
  Prisma,
  PrismaClient,
  UserRole,
  CustomerStatus,
  ProductBillingCycle,
  TrackerStatus,
  SimStatus,
  SimType,
} = pkg;

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

const PASSWORD = "Test1234!";

async function main() {
  console.log("🌱 Seeding Seguilo STM development database...");

  const pwd = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);

  const admin = await prisma.user.upsert({
    where: { email: "admin@seguilo.test" },
    update: {},
    create: {
      email: "admin@seguilo.test",
      name: "Administrator",
      passwordHash: pwd,
      role: UserRole.ADMIN,
    },
  });
  console.log(`  ✅ ADMIN: ${admin.email} / ${PASSWORD}`);

  const employee = await prisma.user.upsert({
    where: { email: "medewerker@seguilo.test" },
    update: {},
    create: {
      email: "medewerker@seguilo.test",
      name: "Medewerker Seguilo",
      passwordHash: pwd,
      role: UserRole.EMPLOYEE,
    },
  });
  console.log(`  ✅ EMPLOYEE: ${employee.email} / ${PASSWORD}`);

  const viewer = await prisma.user.upsert({
    where: { email: "viewer@seguilo.test" },
    update: {},
    create: {
      email: "viewer@seguilo.test",
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
      contactName: "Piet van der Transport",
      email: "info@vandertransport.test",
      phone: "+31612345678",
      street: "Hoofdstraat 12",
      postalCode: "1234 AB",
      city: "Amsterdam",
      country: "NL",
      chamberOfCommerce: "12345678",
      vatNumber: "NL123456789B01",
    },
  });
  console.log(`  ✅ CUSTOMER: ${demoCustomer.companyName}`);

  const prodBasic = await prisma.product.upsert({
    where: { code: "TRK-BASIC" },
    update: {},
    create: {
      code: "TRK-BASIC",
      name: "Basic Tracking",
      description:
        "Standaard voertuig volgen met elke 3 minuten een positie update.",
      monthlyPrice: new Prisma.Decimal("9.95"),
      setupFee: new Prisma.Decimal("19.95"),
      billingCycle: ProductBillingCycle.MONTHLY,
      isActive: true,
    },
  });

  const prodPro = await prisma.product.upsert({
    where: { code: "TRK-PRO" },
    update: {},
    create: {
      code: "TRK-PRO",
      name: "Pro Tracking",
      description:
        "Geavanceerd volgen met 30 seconde interval, rijgedrag rapportages en geofencing.",
      monthlyPrice: new Prisma.Decimal("19.95"),
      setupFee: new Prisma.Decimal("49.00"),
      billingCycle: ProductBillingCycle.MONTHLY,
      isActive: true,
    },
  });

  const prodPremium = await prisma.product.upsert({
    where: { code: "TRK-PREMIUM" },
    update: {},
    create: {
      code: "TRK-PREMIUM",
      name: "Premium Fleet",
      description:
        "Compleet fleet management pakket met API toegang, SLA en dedicated support.",
      monthlyPrice: new Prisma.Decimal("49.00"),
      setupFee: new Prisma.Decimal("149.00"),
      billingCycle: ProductBillingCycle.YEARLY,
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

  const sim1 = await prisma.sim.upsert({
    where: { iccid: "8931041012345678901" },
    update: {},
    create: {
      iccid: "8931041012345678901",
      imsi: "204081234567890",
      msisdn: "31681234567",
      pin: "0000",
      puk: "12345678",
      type: SimType.M2M,
      operator: "KPN IoT",
      status: SimStatus.IN_STOCK,
    },
  });

  const sim2 = await prisma.sim.upsert({
    where: { iccid: "8931041012345678902" },
    update: {},
    create: {
      iccid: "8931041012345678902",
      imsi: "204081234567891",
      msisdn: "31681234568",
      pin: "0000",
      puk: "12345679",
      type: SimType.M2M,
      operator: "KPN IoT",
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
      notes: "Eerste volgsysteem demo.",
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
      description: "Koelwagen -18°C, 2022",
    },
  });
  console.log(
    `  ✅ VEHICLES: ${v1.licensePlate}, ${v2.licensePlate} (${demoCustomer.companyName})`
  );

  console.log("🌱 Seeding klaar.");
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
