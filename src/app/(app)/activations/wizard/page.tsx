import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActivationWizard } from "./_components/activation-wizard";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  createOrderAction,
  updateOrderAction,
  markReadyAction,
  completeActivationAction,
} from "./actions";
import { findActivationOrderById } from "@/server/services/activation-order.service";

type WizardPageProps = {
  searchParams?: { orderId?: string; step?: string };
};

export default async function ActivationWizardPage({
  searchParams,
}: WizardPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "create", "activationOrder")) {
    if (!canUserRole(session.user.role, "edit", "activationOrder")) {
      throw new PermissionError("Je mag geen activatie orders aanmaken of bewerken.");
    }
  }

  const [customers, products, trackersStock, simsStock, vehicles] =
    await Promise.all([
      prisma.customer.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          customerNumber: true,
          companyName: true,
          status: true,
          parentCustomerId: true,
        },
        orderBy: { companyName: "asc" },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          productCode: true,
          name: true,
          monthlyPrice: true,
          description: true,
        },
      }),
      prisma.tracker.findMany({
        where: {
          deletedAt: null,
          status: { in: ["IN_STOCK", "RESERVED"] as any },
        },
        select: {
          id: true,
          serialNumber: true,
          imei: true,
          brand: true,
          model: true,
          status: true,
        },
        orderBy: { serialNumber: "asc" },
      }),
      prisma.sIM.findMany({
        where: {
          deletedAt: null,
          status: { in: ["IN_STOCK", "RESERVED"] as any },
        },
        select: {
          id: true,
          iccid: true,
          imsi: true,
          msisdn: true,
          provider: true,
          status: true,
        },
        orderBy: { iccid: "asc" },
      }),
      prisma.vehicle.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          customerId: true,
          licensePlate: true,
          vin: true,
          brand: true,
          model: true,
          description: true,
        },
      }),
    ]);

  let initial: any = null;
  if (searchParams?.orderId) {
    const order = await findActivationOrderById(searchParams.orderId);
    if (order) {
      initial = {
        id: order.id,
        customerId: order.customerId,
        subCustomerId: order.subCustomerId ?? null,
        productId: order.productId,
        desiredStartDate: order.desiredStartDate.toISOString().slice(0, 10),
        monthlyPrice: Number(order.monthlyPrice),
        billingCycle: order.billingCycle,
        trackerId: order.trackerId ?? null,
        simId: order.simId ?? null,
        vehicleId: order.vehicleId ?? null,
        internalNotes: order.internalNotes ?? "",
        status: order.status,
        orderNumber: order.orderNumber,
      };
    }
  }

  const vehiclesByCustomer = (customerId: string) =>
    vehicles.filter((v) => v.customerId === customerId);

  return (
    <Suspense fallback={<div>Laden...</div>}>
      <ActivationWizard
        role={session.user.role as any}
        customerOptions={customers as any}
        productOptions={products as any}
        trackerStock={trackersStock as any}
        simStock={simsStock as any}
        customerVehicles={vehiclesByCustomer as any}
        initialOrder={initial}
        createAction={createOrderAction as any}
        updateAction={updateOrderAction as any}
        markReadyAction={markReadyAction as any}
        completeActivationAction={completeActivationAction as any}
      />
    </Suspense>
  );
}
