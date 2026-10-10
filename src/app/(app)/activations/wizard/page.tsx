import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { Suspense } from "react";
import { ActivationWizard } from "../_components/activation-wizard";
import { prisma } from "@/lib/prisma";
import {
  createOrderAction,
  updateOrderAction,
  markReadyAction,
  completeActivationAction,
  validateAndSubscribeSimAction,
} from "../actions";
import { findActivationOrderById } from "@/server/services/activation-order.service";
import { ActivationOrderProductType } from "@/types/enums";

type WizardPageProps = {
  searchParams?: { orderId?: string; step?: string };
};

export default async function ActivationWizardPage({
  searchParams,
}: WizardPageProps) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "activation_order")) {
    if (!canUserRole(user.permissions, "edit", "activation_order")) {
      redirectForbidden();
    }
  }

  const customerIds = user.customerIds ?? [];
  const hasScope = customerIds.length > 0;
  const customerScopeCustomer: any = hasScope ? { id: { in: customerIds } } : undefined;
  const customerScopeAssignment: any = hasScope
    ? { assignments: { some: { subscription: { customerId: { in: customerIds } } } } }
    : undefined;
  const customerScopeVehicle: any = hasScope ? { customerId: { in: customerIds } } : undefined;

  const [customers, products, trackersStock, simsStock, vehicles, dataPlans] =
    await Promise.all([
      prisma.customer.findMany({
        where: { deletedAt: null, ...customerScopeCustomer },
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
          ...customerScopeAssignment,
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
          ...customerScopeAssignment,
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
        where: { deletedAt: null, ...customerScopeVehicle },
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
      prisma.dataPlan.findMany({
        where: { isActive: true, simOnlyAvailable: true },
        select: {
          id: true,
          name: true,
          dataAmountBytes: true,
          dataAmountDisplayUnit: true,
          monthlyPrice: true,
          currency: true,
          validityDays: true,
          validityBillingCycle: true,
          provider: true,
        },
        orderBy: { name: "asc" },
      }),
    ]);

  let initial: any = null;
  if (searchParams?.orderId) {
    const order = await findActivationOrderById(searchParams.orderId, user.customerIds);
    if (order) {
      initial = {
        id: order.id,
        customerId: order.customerId,
        subCustomerId: order.subCustomerId ?? null,
        productId: order.productId,
        dataPlanId: (order as any).dataPlanId ?? null,
        orderType: (order as any).orderType ?? ActivationOrderProductType.TRACKER_WITH_SIM,
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

  const productOptions = products.map((p) => ({
    id: p.id,
    productCode: p.productCode,
    name: p.name,
    monthlyPrice: Number(p.monthlyPrice),
    description: p.description,
  }));

  const dataPlanOptions = dataPlans.map((dp: any) => ({
    id: dp.id,
    name: dp.name,
    dataAmountBytes: dp.dataAmountBytes,
    dataAmountDisplayUnit: dp.dataAmountDisplayUnit,
    monthlyPrice: dp.monthlyPrice,
    currency: dp.currency,
    validityDays: dp.validityDays,
    validityBillingCycle: dp.validityBillingCycle,
    provider: dp.provider,
  }));

  const canSimOnly = canUserRole(user.permissions, "sim_only_order", "activation_order");

  const vehiclesByCustomer: Record<string, any[]> = {};
  for (const v of vehicles) {
    if (!vehiclesByCustomer[v.customerId]) vehiclesByCustomer[v.customerId] = [];
    vehiclesByCustomer[v.customerId].push({
      id: v.id,
      licensePlate: v.licensePlate,
      vin: v.vin,
      brand: v.brand,
      model: v.model,
      description: v.description,
    });
  }

  return (
    <Suspense fallback={<div>Laden...</div>}>
      <ActivationWizard
        role={user.role as any}
        customerOptions={customers as any}
        productOptions={productOptions}
        dataPlanOptions={dataPlanOptions}
        canSimOnly={canSimOnly}
        trackerStock={trackersStock as any}
        simStock={simsStock as any}
        vehiclesByCustomerMap={vehiclesByCustomer}
        initialOrder={initial}
        createAction={createOrderAction as any}
        updateAction={updateOrderAction as any}
        markReadyAction={markReadyAction as any}
        completeActivationAction={completeActivationAction as any}
        validateAndSubscribeSimAction={validateAndSubscribeSimAction as any}
      />
    </Suspense>
  );
}
