import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import { CreateContactSchema, UpdateContactSchema, DeleteContactSchema } from "@/server/validators/contact";
import type { CreateContactInput, UpdateContactInput, DeleteContactInput } from "@/server/validators/contact";
import type { UserRole, RoleScope } from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";
import type { ContactPerson as PrismaContactPerson, Prisma } from "@prisma/client";
import { pickAuth, requirePermission } from "@/lib/rbac";

type Ctx = {
  userId: string;
  userRole: UserRole;
  roleId?: string;
  roleScope?: RoleScope;
  customerId?: string | null;
  customerScope?: string[];
  permissions?: PermissionBits;
};

export interface ContactListOptions {
  includeDeleted?: boolean;
  orderBy?: Prisma.ContactPersonOrderByWithRelationInput;
}

async function validateCustomerScope(
  customerId: string,
  ctx: { customerScope?: string[]; roleScope?: RoleScope; customerId?: string | null }
) {
  if (ctx.roleScope === "INTERNAL" && !ctx.customerScope) return;
  if (ctx.roleScope === "CUSTOMER" && ctx.customerId && ctx.customerId !== customerId) {
    throw new Error("Onvoldoende rechten: contactpersonen vallen buiten je klantscope.");
  }
  if (ctx.customerScope && ctx.customerScope.length > 0 && !ctx.customerScope.includes(customerId)) {
    throw new Error("Klant valt niet binnen je toegang (customer-scope).");
  }
}

export async function listContactsForCustomer(
  customerId: string,
  opts: ContactListOptions = {},
  ctx?: Ctx
): Promise<PrismaContactPerson[]> {
  if (ctx) {
    await requirePermission(pickAuth(ctx), "view", "customer");
    await validateCustomerScope(customerId, ctx);
  }
  const where: Prisma.ContactPersonWhereInput = { customerId };
  if (!opts.includeDeleted) where.deletedAt = null;
  return prisma.contactPerson.findMany({
    where,
    orderBy: opts.orderBy ?? [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

export async function getContactDetail(
  id: string,
  opts: ContactListOptions = {},
  ctx?: Ctx
): Promise<PrismaContactPerson | null> {
  if (ctx) await requirePermission(pickAuth(ctx), "view", "customer");
  const where: Prisma.ContactPersonWhereUniqueInput & Prisma.ContactPersonWhereInput = { id };
  if (!opts.includeDeleted) where.deletedAt = null;
  const contact = await prisma.contactPerson.findUnique({ where });
  if (contact && ctx) await validateCustomerScope(contact.customerId, ctx);
  return contact;
}

export async function createContactService(
  dto: CreateContactInput,
  ctx: Ctx
): Promise<PrismaContactPerson> {
  await requirePermission(pickAuth(ctx), "create", "customer");
  const parsed = CreateContactSchema.parse(dto);
  await validateCustomerScope(parsed.customerId, ctx);

  const customer = await prisma.customer.findUnique({
    where: { id: parsed.customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    throw new Error(`Klant (${parsed.customerId}) bestaat niet.`);
  }

  const created = await prisma.contactPerson.create({
    data: {
      customerId: parsed.customerId,
      firstName: parsed.firstName ?? null,
      lastName: parsed.lastName,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      mobile: parsed.mobile ?? null,
      functionTitle: parsed.functionTitle ?? null,
      inserveContactId: parsed.inserveContactId ?? null,
    },
  });

  try {
    await logAudit(prisma as any, {
      entityType: "contact_person",
      entityId: created.id,
      action: "CREATE_CONTACT",
      userId: ctx.userId,
      newValues: { ...created },
      metadata: { customerId: created.customerId },
    });
  } catch (_auditErr) {
  }

  return created;
}

export async function updateContactService(
  id: string,
  dto: UpdateContactInput,
  ctx: Ctx
): Promise<PrismaContactPerson> {
  await requirePermission(pickAuth(ctx), "edit", "customer");
  const parsed = UpdateContactSchema.parse({ ...dto, id });

  const existing = await prisma.contactPerson.findUnique({
    where: { id: parsed.id, deletedAt: null },
  });
  if (!existing) {
    throw new Error(`Contactpersoon (${parsed.id}) bestaat niet of is verwijderd.`);
  }
  await validateCustomerScope(existing.customerId, ctx);

  const newValues: Prisma.ContactPersonUncheckedUpdateInput = {};
  if (parsed.firstName !== undefined) newValues.firstName = parsed.firstName ?? null;
  if (parsed.lastName !== undefined) newValues.lastName = parsed.lastName;
  if (parsed.email !== undefined) newValues.email = parsed.email ?? null;
  if (parsed.phone !== undefined) newValues.phone = parsed.phone ?? null;
  if (parsed.mobile !== undefined) newValues.mobile = parsed.mobile ?? null;
  if (parsed.functionTitle !== undefined) newValues.functionTitle = parsed.functionTitle ?? null;
  if (parsed.inserveContactId !== undefined) newValues.inserveContactId = parsed.inserveContactId ?? null;

  const updated = await prisma.contactPerson.update({
    where: { id: parsed.id },
    data: newValues,
  });

  const { oldValues, newValues: newValuesDiff } = diffObject(
    existing as unknown as Record<string, unknown>,
    updated as unknown as Record<string, unknown>
  );

  try {
    await logAudit(prisma as any, {
      entityType: "contact_person",
      entityId: updated.id,
      action: "UPDATE_CONTACT",
      userId: ctx.userId,
      oldValues,
      newValues: newValuesDiff,
      metadata: { customerId: updated.customerId },
    });
  } catch (_auditErr) {
  }

  return updated;
}

export async function deleteContactService(
  id: string,
  ctx: Ctx,
  softDelete: boolean = true
): Promise<PrismaContactPerson> {
  await requirePermission(pickAuth(ctx), "delete", "customer");
  DeleteContactSchema.parse({ id });

  const existing = await prisma.contactPerson.findUnique({
    where: { id, deletedAt: softDelete ? null : undefined },
  });
  if (!existing) {
    throw new Error(`Contactpersoon (${id}) bestaat niet of is reeds verwijderd.`);
  }
  await validateCustomerScope(existing.customerId, ctx);

  const result = softDelete
    ? await prisma.contactPerson.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
    : await prisma.contactPerson.delete({ where: { id } });

  try {
    await logAudit(prisma as any, {
      entityType: "contact_person",
      entityId: id,
      action: "DELETE_CONTACT",
      userId: ctx.userId,
      oldValues: { ...existing },
      metadata: { customerId: existing.customerId, softDelete },
    });
  } catch (_auditErr) {
  }

  return result;
}

export async function findContactByInserveId(
  inserveContactId: number,
  opts: { includeDeleted?: boolean } = {}
): Promise<PrismaContactPerson | null> {
  const where: Prisma.ContactPersonWhereInput = {
    inserveContactId,
  };
  if (!opts.includeDeleted) where.deletedAt = null;
  return prisma.contactPerson.findFirst({ where });
}

export async function findSimilarContactsByCustomer(
  customerId: string,
  predicate: { firstName?: string | null; lastName?: string | null; email?: string | null }
): Promise<PrismaContactPerson[]> {
  const { firstName, lastName, email } = predicate;
  const whereOr: Prisma.ContactPersonWhereInput["OR"] = [];
  if (firstName && lastName) {
    whereOr.push({
      AND: [
        { firstName: { equals: firstName, mode: "insensitive" } },
        { lastName: { equals: lastName, mode: "insensitive" } },
      ],
      deletedAt: null,
      customerId,
    });
  }
  if (email) {
    whereOr.push({
      email: { equals: email, mode: "insensitive" },
      deletedAt: null,
      customerId,
    });
  }
  if (whereOr.length === 0) return [];
  return prisma.contactPerson.findMany({ where: { OR: whereOr } });
}
