import { z } from "zod";
import {
  RoleScope,
  ALL_RESOURCE_TYPES,
  CUSTOMER_SCOPE_RESOURCES,
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
      for (const resource of Object.keys(d.permissions)) {
        if (d.scope === RoleScope.CUSTOMER) {
          if (!(CUSTOMER_SCOPE_RESOURCES as readonly string[]).includes(resource)) {
            return false;
          }
        }
      }
      return true;
    },
    {
      message:
        "Klant-rollen kunnen alleen rechten krijgen op: klanten, abonnementen, voertuigen, sim-kaarten, trackers, activeringen, facturen en dashboard",
      path: ["permissions"],
    }
  );

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
