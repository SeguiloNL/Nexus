import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [customers, trackers, sims, vehicles, products, subscriptions, orders, users] =
    await Promise.all([
      prisma.customer.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          customerNumber: true,
          companyName: true,
          status: true,
        },
      }),
      prisma.tracker.findMany({
        where: { deletedAt: null },
        select: { id: true, serialNumber: true, imei: true, status: true },
      }),
      prisma.sIM.findMany({
        where: { deletedAt: null },
        select: { id: true, iccid: true, imsi: true, status: true },
      }),
      prisma.vehicle.findMany({
        where: { deletedAt: null },
        select: { id: true, licensePlate: true, vin: true },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, productCode: true, name: true },
      }),
      prisma.subscription.findMany({
        where: { deletedAt: null },
        select: { id: true, subscriptionNumber: true, status: true },
        take: 500,
      }),
      prisma.activationOrder.findMany({
        select: { id: true, orderNumber: true, status: true },
        take: 500,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true },
      }),
    ]);

  const index = {
    customers: customers.map((c) => ({
      kind: "customer",
      id: c.id,
      customerNumber: c.customerNumber,
      companyName: c.companyName,
      status: c.status,
    })),
    trackers: trackers.map((t) => ({
      kind: "tracker",
      id: t.id,
      serialNumber: t.serialNumber,
      imei: t.imei,
      status: t.status,
    })),
    sims: sims.map((s) => ({
      kind: "sim",
      id: s.id,
      iccid: s.iccid,
      imsi: s.imsi,
      status: s.status,
    })),
    vehicles: vehicles.map((v) => ({
      kind: "vehicle",
      id: v.id,
      licensePlate: v.licensePlate,
      vin: v.vin,
    })),
    products: products.map((p) => ({
      kind: "product",
      id: p.id,
      productCode: p.productCode,
      name: p.name,
    })),
    subscriptions: subscriptions.map((s) => ({
      kind: "subscription",
      id: s.id,
      subscriptionNumber: s.subscriptionNumber,
      status: s.status,
    })),
    orders: orders.map((o) => ({
      kind: "activation_order",
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
    })),
    users: users.map((u) => ({
      kind: "user",
      id: u.id,
      name: u.name,
      email: u.email,
    })),
  };

  return NextResponse.json(index);
}
