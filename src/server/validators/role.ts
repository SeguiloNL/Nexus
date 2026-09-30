import { z } from "zod";
import {
  RoleScope,
  ALL_RESOURCE_TYPES,
  CUSTOMER_SCOPE_RESOURCES,
  RESELLER_SCOPE_RESOURCES,
  PARTNER_SCOPE_RESOURCES,
} from "@/types/enums";
import type { PermissionLevel } from "@/types/domain";
import type { ResourceType } from "@/types/enums";

export const PermissionLevelZod = z.enum(["NONE", "READ", "WRITE"]);

export const PermissionsZod = z
  .record(z.string(), PermissionLevelZod)
  .refine(
    (rec) =>
      Object.keys(rec).every((k) =>
        (ALL_RESOURCE_TYPES as readonly string[]).includes(k)
      ),
    { message: "Ongeldige resource" }
  );

function allowedResourcesForScope(scope: RoleScope): readonly string[] {
  switch (scope) {
    case RoleScope.CUSTOMER:
      return CUSTOMER_SCOPE_RESOURCES as readonly string[];
    case RoleScope.RESELLER:
      return RESELLER_SCOPE_RESOURCES as readonly string[];
    case RoleScope.PARTNER:
      return PARTNER_SCOPE_RESOURCES as readonly string[];
    case RoleScope.INTERNAL:
    default:
      return ALL_RESOURCE_TYPES as readonly string[];
  }
}

const SCOPE_RESOURCE_ERROR: Record<RoleScope, string> = {
  [RoleScope.INTERNAL]:
    "Interne rollen kunnen rechten krijgen op alle functionaliteit.",
  [RoleScope.CUSTOMER]:
    "Klant-rollen kunnen alleen rechten krijgen op: klanten, abonnementen, voertuigen, sim-kaarten, trackers, activeringen, facturen en dashboard",
  [RoleScope.RESELLER]:
    "Reseller-rollen kunnen alleen rechten krijgen op: klanten, abonnementen, voertuigen, sim-kaarten, trackers, activeringen, facturen en dashboard",
  [RoleScope.PARTNER]:
    "Partner-rollen kunnen alleen rechten krijgen op: klanten, abonnementen, voertuigen, sim-kaarten, trackers, activeringen, facturen en dashboard",
};

export const CreateRoleSchema = z
  .object({
    name: z.string().trim().min(1, "Naam is verplicht").max(100, "Naam is te lang"),
    scope: z.nativeEnum(RoleScope, { message: "Ongeldige scope" }),
    description: z
      .string()
      .trim()
      .max(1000, "Beschrijving is te lang")
      .optional()
      .nullable(),
    permissions: PermissionsZod.optional(),
  })
  .refine(
    (d) => {
      if (!d.permissions) return true;
      const allowed = new Set(allowedResourcesForScope(d.scope));
      for (const resource of Object.keys(d.permissions)) {
        if (!allowed.has(resource)) return false;
      }
      return true;
    },
    {
      message: "Deze scope staat niet toe om rechten te geven op deze functionaliteit.",
      path: ["permissions"],
    }
  ).superRefine((d, ctx) => {
    if (!d.permissions) return;
    const allowed = new Set(allowedResourcesForScope(d.scope));
    for (const resource of Object.keys(d.permissions)) {
      if (!allowed.has(resource)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["permissions", resource],
          message: SCOPE_RESOURCE_ERROR[d.scope],
        });
      }
    }
  });

export const UpdateRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Naam is verplicht")
    .max(100, "Naam is te lang")
    .optional(),
  description: z
    .string()
    .trim()
    .max(1000, "Beschrijving is te lang")
    .optional()
    .nullable(),
  permissions: PermissionsZod.optional(),
});

export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
