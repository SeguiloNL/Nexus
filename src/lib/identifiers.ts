import { prisma } from "./prisma";

/**
 * Genereert een klantnummer in het formaat K-YYYY-NNNNN
 */
export async function generateCustomerNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `K-${year}-`;

  const latest = await prisma.customer.findFirst({
    where: { customerNumber: { startsWith: prefix } },
    orderBy: { customerNumber: "desc" },
    select: { customerNumber: true },
  });

  let next = 1;
  if (latest?.customerNumber) {
    const suffix = latest.customerNumber.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!Number.isNaN(num)) next = num + 1;
  }

  return `${prefix}${next.toString().padStart(5, "0")}`;
}

/**
 * Genereert een abonnementnummer in het formaat SUB-YYYY-NNNNNN
 */
export async function generateSubscriptionNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SUB-${year}-`;

  const latest = await prisma.subscription.findFirst({
    where: { subscriptionNumber: { startsWith: prefix } },
    orderBy: { subscriptionNumber: "desc" },
    select: { subscriptionNumber: true },
  });

  let next = 1;
  if (latest?.subscriptionNumber) {
    const suffix = latest.subscriptionNumber.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!Number.isNaN(num)) next = num + 1;
  }

  return `${prefix}${next.toString().padStart(6, "0")}`;
}

/**
 * Genereert een activatie-ordernummer in het formaat ACT-YYYY-NNNNNN
 */
export async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ACT-${year}-`;

  const latest = await prisma.activationOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  let next = 1;
  if (latest?.orderNumber) {
    const suffix = latest.orderNumber.slice(prefix.length);
    const num = parseInt(suffix, 10);
    if (!Number.isNaN(num)) next = num + 1;
  }

  return `${prefix}${next.toString().padStart(6, "0")}`;
}
