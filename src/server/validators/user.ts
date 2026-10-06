import { z } from "zod";
import { validateEmail } from "@/lib/validation";
import { UserRole } from "@/types/enums";

export const CreateUserSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "E-mail is verplicht")
    .refine(validateEmail, "Ongeldig e-mailadres"),
  name: z.string().trim().min(1, "Naam is verplicht"),
  password: z.string().min(8, "Wachtwoord moet minimaal 8 tekens bevatten"),
  role: z.nativeEnum(UserRole, { message: "Ongeldige rol" }).optional(),
  roleId: z.string().min(1, "Rol-ID is verplicht").optional(),
  customerId: z.string().min(1, "Klant-ID is verplicht").optional().nullable(),
  customerIds: z.array(z.string().cuid()).min(0).optional(),
  isActive: z.boolean().optional(),
}).refine((data) => (data.roleId ? true : data.role !== undefined), {
  message: "Een rol (roleId of role) is verplicht",
  path: ["roleId"],
});

export const UpdateUserSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "E-mail is verplicht")
    .refine(validateEmail, "Ongeldig e-mailadres")
    .optional(),
  name: z.string().trim().min(1, "Naam is verplicht").optional(),
  password: z
    .string()
    .min(8, "Wachtwoord moet minimaal 8 tekens bevatten")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  role: z.nativeEnum(UserRole, { message: "Ongeldige rol" }).optional(),
  roleId: z.string().min(1, "Rol-ID is verplicht").optional(),
  customerId: z.string().min(1, "Klant-ID is verplicht").optional().nullable(),
  customerIds: z.array(z.string().cuid()).min(0).optional(),
  isActive: z.boolean().optional(),
});

export const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "E-mail is verplicht")
    .refine(validateEmail, "Ongeldig e-mailadres"),
  password: z.string().min(1, "Wachtwoord is verplicht"),
});

export const UpdateUserCustomersSchema = z.object({
  customerIds: z.array(z.string().cuid()).min(0),
});

export const ToggleUserActiveSchema = z.object({
  isActive: z.boolean(),
});

export const BulkUpdateRoleSchema = z.object({
  userIds: z.array(z.string().cuid()).min(1),
  roleId: z.string().cuid(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type UpdateUserCustomersInput = z.infer<typeof UpdateUserCustomersSchema>;
export type ToggleUserActiveInput = z.infer<typeof ToggleUserActiveSchema>;
export type BulkUpdateRoleInput = z.infer<typeof BulkUpdateRoleSchema>;

/* ========================= Notificatie instellingen ========================= */

export const SaveNotificationSettingsSchema = z.object({
  enabledEmail: z.boolean().default(true),
  enabledDataThresholdAlert: z.boolean().default(true),
  dataThresholdPercent: z.coerce
    .number()
    .int()
    .min(1, "Drempel minimaal 1%")
    .max(99, "Drempel maximaal 99%")
    .default(80),
  notifyAllSims: z.boolean().default(false),
});

export type SaveNotificationSettingsInput = z.infer<typeof SaveNotificationSettingsSchema>;
