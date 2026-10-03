import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await getCurrentUser();
  } catch (_e) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const perms = user.permissions;

  const can = (resource: string) => canUserRole(perms, "view", resource as any);

  const hasAnyRight =
    can("customer") ||
    can("tracker") ||
    can("sim") ||
    can("vehicle") ||
    can("product") ||
    can("subscription") ||
    can("activation_order") ||
    can("user") ||
    can("dashboard");

  if (!hasAnyRight) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const customerIds = user.customerIds ?? [];
  const hasScope = customerIds.length > 0;

  const customerScopeCustomer: any = hasScope
    ? { id: { in: customerIds } }
    : undefined;
  const customerScopeSubscription: any = hasScope
    ? { customerId: { in: customerIds } }
    : undefined;
  const customerScopeVehicle: any = hasScope
    ? { customerId: { in: customerIds } }
    : undefined;
  const customerScopeAssignment: any = hasScope
    ? {
        assignments: {
          some: { subscription: { customerId: { in: customerIds } } },
        },
      }
    : undefined;
  const customerScopeActivation: any = hasScope
    ? {
        OR: [
          { customerId: { in: customerIds } },
          { subCustomerId: { in: customerIds } },
        ],
      }
    : undefined;
  const customerScopeUser: any = hasScope
    ? { customerId: { in: customerIds } }
    : user.roleScope === "CUSTOMER"
      ? { customerId: "" }
      : undefined;

  const emptyArray: any[] = [];

  const [customers, trackers, sims, vehicles, products, subscriptions, orders, users] =
    await Promise.all([
      can("customer")
        ? prisma.customer.findMany({
            where: { deletedAt: null, ...customerScopeCustomer },
            select: {
              id: true,
              customerNumber: true,
              companyName: true,
              status: true,
            },
          })
        : Promise.resolve(emptyArray),
      can("tracker")
        ? prisma.tracker.findMany({
            where: { deletedAt: null, ...customerScopeAssignment },
            select: { id: true, serialNumber: true, imei: true, status: true },
          })
        : Promise.resolve(emptyArray),
      can("sim")
        ? prisma.sIM.findMany({
            where: { deletedAt: null, ...customerScopeAssignment },
            select: { id: true, iccid: true, msisdn: true, imsi: true, status: true },
          })
        : Promise.resolve(emptyArray),
      can("vehicle")
        ? prisma.vehicle.findMany({
            where: { deletedAt: null, ...customerScopeVehicle },
            select: { id: true, licensePlate: true, vin: true },
          })
        : Promise.resolve(emptyArray),
      can("product")
        ? prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, productCode: true, name: true },
          })
        : Promise.resolve(emptyArray),
      can("subscription")
        ? prisma.subscription.findMany({
            where: { deletedAt: null, ...customerScopeSubscription },
            select: { id: true, subscriptionNumber: true, status: true },
            take: 500,
          })
        : Promise.resolve(emptyArray),
      can("activation_order")
        ? prisma.activationOrder.findMany({
            select: { id: true, orderNumber: true, status: true },
            take: 500,
            orderBy: { createdAt: "desc" },
            where: customerScopeActivation ?? undefined,
          })
        : Promise.resolve(emptyArray),
      can("user")
        ? prisma.user.findMany({
            select: { id: true, name: true, email: true },
            where: customerScopeUser ?? undefined,
          })
        : Promise.resolve(emptyArray),
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
      msisdn: s.msisdn,
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
