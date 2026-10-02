import type { DefaultSession } from "next-auth";
import type { UserRole, RoleScope, ResourceType } from "./enums";

export type PermissionBits = Record<ResourceType, { read: boolean; write: boolean }>;

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      roleId: string;
      roleScope: RoleScope;
      roleName: string;
      email: string;
      name: string;
      isActive: boolean;
      customerId: string | null;
      customerIds: string[];
      permissions: PermissionBits;
      customerScopeRefreshedAt?: number;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: UserRole;
    roleId: string;
    roleScope: RoleScope;
    roleName: string;
    email: string;
    name: string;
    isActive: boolean;
    customerId: string | null;
    customerIds: string[];
    permissions: PermissionBits;
  }

  interface JWT {
    id: string;
    role: UserRole;
    roleId: string;
    roleScope: RoleScope;
    roleName: string;
    email: string;
    name: string;
    isActive: boolean;
    customerId: string | null;
    customerIds: string[];
    permissions: PermissionBits;
    customerScopeRefreshedAt?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    roleId: string;
    roleScope: RoleScope;
    roleName: string;
    email: string;
    name: string;
    isActive: boolean;
    customerId: string | null;
    customerIds: string[];
    permissions: PermissionBits;
    customerScopeRefreshedAt?: number;
  }
}
