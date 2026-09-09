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
  role: z.nativeEnum(UserRole, { message: "Ongeldige rol" }),
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
});

export const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "E-mail is verplicht")
    .refine(validateEmail, "Ongeldig e-mailadres"),
  password: z.string().min(1, "Wachtwoord is verplicht"),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
