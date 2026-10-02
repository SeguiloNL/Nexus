import { describe, it, expect } from "vitest";
import { RoleScope, UserRole, CustomerType, AuditAction, ResourceType } from "@/types/enums";

type SimRole = {
  id: string;
  name: string;
  scope: RoleScope;
  isSystem: boolean;
  isDefault: boolean;
  description: string | null;
  permissions: Array<{ resource: ResourceType; read: boolean; write: boolean }>;
};

type SimUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  roleId: string | null;
  customerId: string | null;
  isActive: boolean;
  customerLinks: Array<{ customerId: string; assignedAt: Date; assignedBy: string | null }>;
};

type SimAuditLog = {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValues: any;
  newValues: any;
  userId: string | null;
  timestamp: Date;
};

type SimDB = {
  users: Map<string, SimUser>;
  roles: Map<string, SimRole>;
  audits: SimAuditLog[];
  seq: number;
};

function newId(prefix: string, db: SimDB) {
  db.seq += 1;
  return `${prefix}_${db.seq.toString().padStart(3, "0")}`;
}

function newDB(): SimDB {
  const db = {
    users: new Map<string, SimUser>(),
    roles: new Map<string, SimRole>(),
    audits: [] as SimAuditLog[],
    seq: 0,
  };
  const adminRole: SimRole = {
    id: "r_admin",
    name: "Beheerder",
    scope: RoleScope.INTERNAL,
    isSystem: true,
    isDefault: false,
    description: "Systeemrol",
    permissions: [],
  };
  db.roles.set(adminRole.id, adminRole);
  return db;
}

function logAudit(db: SimDB, entry: Omit<SimAuditLog, "id" | "timestamp">) {
  db.audits.push({
    id: newId("audit", db),
    timestamp: new Date(),
    ...entry,
  });
}

function simCreateUser(
  db: SimDB,
  input: {
    email: string;
    name?: string | null;
    role?: UserRole;
    roleId?: string | null;
    customerIds?: string[];
    customerId?: string | null;
    isActive?: boolean;
  },
  ctx: { userId: string }
): SimUser {
  const id = newId("u", db);
  const role = input.role ?? UserRole.VIEWER;
  const customerIds = input.customerIds ?? (input.customerId ? [input.customerId] : []);
  const legacyCustomerId = customerIds[0] ?? input.customerId ?? null;
  const now = new Date();
  const user: SimUser = {
    id,
    email: input.email,
    name: input.name ?? null,
    role,
    roleId: input.roleId ?? null,
    customerId: legacyCustomerId,
    isActive: input.isActive ?? true,
    customerLinks: customerIds.map((cid) => ({
      customerId: cid,
      assignedAt: now,
      assignedBy: ctx.userId,
    })),
  };
  db.users.set(id, user);
  logAudit(db, {
    action: AuditAction.CREATE,
    entityType: "user",
    entityId: id,
    oldValues: null,
    newValues: { email: user.email, role, isActive: user.isActive },
    userId: ctx.userId,
  });
  for (const cid of customerIds) {
    logAudit(db, {
      action: AuditAction.LINK_USER_CUSTOMER,
      entityType: "user",
      entityId: id,
      oldValues: null,
      newValues: { customerId: cid },
      userId: ctx.userId,
    });
  }
  return user;
}

function simUpdateUserCustomerLinks(
  db: SimDB,
  userId: string,
  nextIds: string[],
  ctx: { userId: string }
): { linked: string[]; unlinked: string[] } {
  const user = db.users.get(userId);
  if (!user) throw new Error("User not found");
  const currentIds = new Set(user.customerLinks.map((l) => l.customerId));
  const nextSet = new Set(nextIds);
  const linked: string[] = [];
  const unlinked: string[] = [];
  for (const id of nextIds) {
    if (!currentIds.has(id)) {
      user.customerLinks.push({
        customerId: id,
        assignedAt: new Date(),
        assignedBy: ctx.userId,
      });
      linked.push(id);
      logAudit(db, {
        action: AuditAction.LINK_USER_CUSTOMER,
        entityType: "user",
        entityId: userId,
        oldValues: null,
        newValues: { customerId: id },
        userId: ctx.userId,
      });
    }
  }
  user.customerLinks = user.customerLinks.filter((l) => {
    if (!nextSet.has(l.customerId)) {
      unlinked.push(l.customerId);
      logAudit(db, {
        action: AuditAction.UNLINK_USER_CUSTOMER,
        entityType: "user",
        entityId: userId,
        oldValues: { customerId: l.customerId },
        newValues: null,
        userId: ctx.userId,
      });
      return false;
    }
    return true;
  });
  user.customerId = nextIds[0] ?? user.customerId;
  return { linked, unlinked };
}

function simToggleUserActive(
  db: SimDB,
  userId: string,
  nextActive: boolean,
  ctx: { userId: string }
): SimUser {
  const user = db.users.get(userId);
  if (!user) throw new Error("User not found");
  if (user.id === ctx.userId) {
    throw new Error("Je kunt je eigen account niet (de)activeren.");
  }
  const oldValues = { isActive: user.isActive };
  user.isActive = nextActive;
  logAudit(db, {
    action: AuditAction.TOGGLE_USER_ACTIVE,
    entityType: "user",
    entityId: userId,
    oldValues,
    newValues: { isActive: user.isActive },
    userId: ctx.userId,
  });
  return user;
}

function simBulkUpdateUserRole(
  db: SimDB,
  userIds: string[],
  roleId: string,
  ctx: { userId: string }
): { updated: number } {
  const role = db.roles.get(roleId);
  if (!role) throw new Error("Role not found");
  let updated = 0;
  for (const uid of userIds) {
    const user = db.users.get(uid);
    if (!user) continue;
    const oldValues = { roleId: user.roleId, role: user.role };
    user.roleId = roleId;
    const scopeMap: Record<RoleScope, UserRole> = {
      [RoleScope.INTERNAL]: UserRole.EMPLOYEE,
      [RoleScope.RESELLER]: UserRole.EMPLOYEE,
      [RoleScope.PARTNER]: UserRole.EMPLOYEE,
      [RoleScope.CUSTOMER]: UserRole.VIEWER,
    };
    user.role = scopeMap[role.scope] ?? user.role;
    logAudit(db, {
      action: AuditAction.BULK_UPDATE_ROLE,
      entityType: "user",
      entityId: uid,
      oldValues,
      newValues: { roleId, role: user.role, scope: role.scope },
      userId: ctx.userId,
    });
    updated += 1;
  }
  return { updated };
}

function simCloneRole(
  db: SimDB,
  sourceRoleId: string,
  input: { name: string; scope?: RoleScope; description?: string | null },
  ctx: { userId: string }
): SimRole {
  const source = db.roles.get(sourceRoleId);
  if (!source) throw new Error("Source role not found");
  const name = input.name.trim();
  for (const r of db.roles.values()) {
    if (r.name === name && r.scope === (input.scope ?? source.scope)) {
      throw new Error("Een rol met dezelfde naam en scope bestaat al.");
    }
  }
  const targetScope = input.scope ?? source.scope;
  const allowedByScope = (resource: ResourceType) => {
    if (targetScope === RoleScope.INTERNAL) return true;
    if (targetScope === RoleScope.RESELLER) {
      const list = ["customer", "subscription", "tracker", "sim", "vehicle", "activation_order", "invoice", "dashboard"];
      return list.includes(resource);
    }
    if (targetScope === RoleScope.PARTNER) {
      const list = ["customer", "subscription", "tracker", "sim", "vehicle", "activation_order", "invoice", "dashboard"];
      return list.includes(resource);
    }
    const list = ["customer", "subscription", "tracker", "sim", "vehicle", "activation_order", "dashboard"];
    return list.includes(resource);
  };
  const id = newId("r", db);
  const cloned: SimRole = {
    id,
    name,
    scope: targetScope,
    isSystem: false,
    isDefault: false,
    description: input.description ?? source.description,
    permissions: source.permissions
      .filter((p) => allowedByScope(p.resource))
      .map((p) => ({ resource: p.resource, read: p.read, write: p.write })),
  };
  db.roles.set(id, cloned);
  logAudit(db, {
    action: AuditAction.CLONE_ROLE,
    entityType: "role",
    entityId: id,
    oldValues: null,
    newValues: {
      name: cloned.name,
      scope: cloned.scope,
      sourceRoleId,
      permissionCount: cloned.permissions.length,
    },
    userId: ctx.userId,
  });
  return cloned;
}

describe("User lifecycle simulatie (M:N junction + legacy fallback)", () => {
  it("createUser met customerIds[] schrijft BOTH legacy customerId en junction", () => {
    const db = newDB();
    const u = simCreateUser(
      db,
      {
        email: "jip@nexus.test",
        name: "Jip",
        role: UserRole.EMPLOYEE,
        customerIds: ["c-a", "c-b"],
      },
      { userId: "admin_sys" }
    );
    expect(u.customerId).toBe("c-a");
    expect(u.customerLinks.map((l) => l.customerId).sort()).toEqual(["c-a", "c-b"]);
    expect(u.isActive).toBe(true);
    const linkAudits = db.audits.filter((a) => a.action === AuditAction.LINK_USER_CUSTOMER);
    expect(linkAudits).toHaveLength(2);
    expect(linkAudits.map((a) => a.newValues.customerId).sort()).toEqual(["c-a", "c-b"]);
  });

  it("updateUserCustomerLinks diff + auditlog LINK/UNLINK", () => {
    const db = newDB();
    const u = simCreateUser(
      db,
      { email: "x@t.nl", customerIds: ["c1", "c2", "c3"] },
      { userId: "admin" }
    );
    const res = simUpdateUserCustomerLinks(db, u.id, ["c2", "c4"], { userId: "admin" });
    expect(res.linked).toEqual(["c4"]);
    expect(res.unlinked.sort()).toEqual(["c1", "c3"]);
    expect(
      db.users.get(u.id)!.customerLinks.map((l) => l.customerId).sort()
    ).toEqual(["c2", "c4"]);
    const unlinkAudits = db.audits.filter((a) => a.action === AuditAction.UNLINK_USER_CUSTOMER);
    expect(unlinkAudits).toHaveLength(2);
  });

  it("toggleUserActive blokkeert eigen-account en schrijft TOGGLE_USER_ACTIVE audit", () => {
    const db = newDB();
    const admin = simCreateUser(
      db,
      { email: "admin@t.nl", role: UserRole.ADMIN, customerId: null },
      { userId: "boot" }
    );
    expect(() => simToggleUserActive(db, admin.id, false, { userId: admin.id })).toThrow(
      /eigen account niet/
    );
    const victim = simCreateUser(
      db,
      { email: "v@t.nl", role: UserRole.VIEWER },
      { userId: admin.id }
    );
    const after = simToggleUserActive(db, victim.id, false, { userId: admin.id });
    expect(after.isActive).toBe(false);
    const toggle = db.audits.findLast((a) => a.action === AuditAction.TOGGLE_USER_ACTIVE);
    expect(toggle?.oldValues.isActive).toBe(true);
    expect(toggle?.newValues.isActive).toBe(false);
  });

  it("bulkUpdateUserRole wijzigt roleId per user en schrijft per-user BULK_UPDATE_ROLE audit", () => {
    const db = newDB();
    const role: SimRole = {
      id: "r_custom",
      name: "Reseller Beheerder",
      scope: RoleScope.RESELLER,
      isSystem: false,
      isDefault: false,
      description: null,
      permissions: [],
    };
    db.roles.set(role.id, role);
    const u1 = simCreateUser(db, { email: "u1@t" }, { userId: "boot" });
    const u2 = simCreateUser(db, { email: "u2@t" }, { userId: "boot" });
    const u3 = simCreateUser(db, { email: "u3@t" }, { userId: "boot" });
    const r = simBulkUpdateUserRole(db, [u1.id, u2.id, u3.id, "nonexistent"], role.id, {
      userId: "boot",
    });
    expect(r.updated).toBe(3);
    expect(db.users.get(u1.id)!.roleId).toBe(role.id);
    expect(db.users.get(u1.id)!.role).toBe(UserRole.EMPLOYEE);
    const bulkAudits = db.audits.filter((a) => a.action === AuditAction.BULK_UPDATE_ROLE);
    expect(bulkAudits).toHaveLength(3);
  });
});

describe("Role cloning simulatie (scope-filter + auditlog)", () => {
  it("cloneRole kopieert permissies, filtert op doel-scope, schrijft CLONE_ROLE audit", () => {
    const db = newDB();
    const perms: SimRole["permissions"] = [
      { resource: "customer", read: true, write: true },
      { resource: "subscription", read: true, write: true },
      { resource: "user", read: true, write: false },
      { resource: "role", read: true, write: false },
    ];
    const source: SimRole = {
      id: "r_int",
      name: "Internal Medewerker",
      scope: RoleScope.INTERNAL,
      isSystem: false,
      isDefault: false,
      description: "Heeft user/role inzage",
      permissions: perms,
    };
    db.roles.set(source.id, source);

    const cloned = simCloneRole(
      db,
      source.id,
      { name: "Kopie van Internal Medewerker", scope: RoleScope.RESELLER },
      { userId: "boot" }
    );
    expect(cloned.scope).toBe(RoleScope.RESELLER);
    expect(cloned.isSystem).toBe(false);
    const resources = cloned.permissions.map((p) => p.resource).sort();
    expect(resources).toEqual(["customer", "subscription"]);
    expect(resources).not.toContain("user");
    expect(resources).not.toContain("role");

    const cloneAudit = db.audits.find((a) => a.action === AuditAction.CLONE_ROLE);
    expect(cloneAudit).toBeDefined();
    expect(cloneAudit?.entityType).toBe("role");
    expect(cloneAudit?.newValues.sourceRoleId).toBe(source.id);
    expect(cloneAudit?.newValues.permissionCount).toBe(2);
  });

  it("cloneRole met duplicate naam+scope → fout", () => {
    const db = newDB();
    const src: SimRole = {
      id: "r_src",
      name: "X",
      scope: RoleScope.CUSTOMER,
      isSystem: false,
      isDefault: false,
      description: null,
      permissions: [],
    };
    db.roles.set(src.id, src);
    db.roles.set("r_dup", { ...src, id: "r_dup", name: "Kopie X" });
    expect(() =>
      simCloneRole(db, src.id, { name: "Kopie X", scope: RoleScope.CUSTOMER }, { userId: "boot" })
    ).toThrow(/zelfde naam en scope bestaat al/);
  });

  it("cloneRole zonder scope-opgave → neemt scope van de bron over", () => {
    const db = newDB();
    const src: SimRole = {
      id: "r_s",
      name: "Partner Basis",
      scope: RoleScope.PARTNER,
      isSystem: false,
      isDefault: false,
      description: null,
      permissions: [{ resource: "customer", read: true, write: false }],
    };
    db.roles.set(src.id, src);
    const cloned = simCloneRole(db, src.id, { name: "Partner Basis (kopie)" }, { userId: "u" });
    expect(cloned.scope).toBe(RoleScope.PARTNER);
  });
});
