import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { logAudit } from "./audit.service";
import type {
  PaginatedResult,
  CreateUserInput,
  UpdateUserInput,
} from "@/types/domain";
import type { UserRole } from "@/types/enums";
import type { Prisma, User } from "@prisma/client";

type Ctx = { userId: string; userRole: UserRole };

export async function findManyUsers(
  params: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    role?: UserRole;
  } = {}
): Promise<PaginatedResult<User>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    role,
  } = params;

  const where: Prisma.UserWhereInput = {};
  if (role) where.role = role;
  if (search) {
    const s = search.trim();
    where.OR = [
      { email: { contains: s, mode: "insensitive" } },
      { name: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortKey: keyof Prisma.UserOrderByWithRelationInput =
    sort === "email" ? "email" : sort === "name" ? "name" : sort === "role" ? "role" : "createdAt";

  const skip = (page - 1) * perPage;
  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { [sortKey]: order } as Prisma.UserOrderByWithRelationInput,
      take: perPage,
      skip,
    }),
  ]);

  return {
    data,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export async function createUser(
  input: CreateUserInput,
  ctx: Ctx
): Promise<User> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new Error("Er bestaat al een gebruiker met dit e-mailadres.");
    }

    const passwordHash = await hashPassword(input.password);
    const created = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
      },
    });

    await logAudit(tx, {
      entityType: "user",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
      } as any,
    });

    return created;
  });
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
  ctx: Ctx
): Promise<User> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUniqueOrThrow({ where: { id } });
    const data: Prisma.UserUpdateInput = {};

    if (input.email != null && input.email !== existing.email) {
      const duplicate = await tx.user.findUnique({ where: { email: input.email } });
      if (duplicate && duplicate.id !== id) {
        throw new Error("Er bestaat al een gebruiker met dit e-mailadres.");
      }
      data.email = input.email;
    }
    if (input.name != null) data.name = input.name;
    if (input.role != null) data.role = input.role;
    if (input.password != null && input.password !== "") {
      data.passwordHash = await hashPassword(input.password);
    }

    const updated = await tx.user.update({ where: { id }, data });

    const changedFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === "passwordHash") continue;
      if (JSON.stringify((existing as any)[k]) !== JSON.stringify(v)) {
        changedFields[k] = v;
      }
    }
    if (Object.keys(changedFields).length > 0 || input.password != null) {
      await logAudit(tx, {
        entityType: "user",
        entityId: updated.id,
        action: "UPDATE",
        userId: ctx.userId,
        oldValues: {
          ...(input.email != null ? { email: existing.email } : {}),
          ...(input.name != null ? { name: existing.name } : {}),
          ...(input.role != null ? { role: existing.role } : {}),
          ...(input.password != null ? { password: "[redacted]" } : {}),
        },
        newValues: {
          ...changedFields,
          ...(input.password != null ? { password: "[redacted]" } : {}),
        },
      });
    }

    return updated;
  });
}

export async function deleteUser(id: string, ctx: Ctx): Promise<User> {
  return prisma.$transaction(async (tx) => {
    if (id === ctx.userId) {
      throw new Error("Je kunt je eigen account niet verwijderen.");
    }
    const existing = await tx.user.findUniqueOrThrow({ where: { id } });
    const deleted = await tx.user.delete({ where: { id } });
    await logAudit(tx, {
      entityType: "user",
      entityId: id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: {
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role,
      } as any,
    });
    return deleted;
  });
}

export async function updateLastLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}
