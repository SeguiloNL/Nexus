import { z } from "zod";
import { validateEmail, validatePhone } from "@/lib/validation";

export const CreateContactSchema = z.object({
  customerId: z.string().trim().min(1, "Klant is verplicht"),
  firstName: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),
  lastName: z
    .string()
    .trim()
    .min(1, "Achternaam is verplicht")
    .refine((v) => v.length > 0, "Achternaam is verplicht"),
  email: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v))
    .refine(
      (val) => !val || validateEmail(val),
      "Ongeldig e-mailadres"
    ),
  phone: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v))
    .refine(
      (val) => !val || validatePhone(val),
      "Ongeldig telefoonnummer"
    ),
  mobile: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v))
    .refine(
      (val) => !val || validatePhone(val),
      "Ongeldig mobiel telefoonnummer"
    ),
  functionTitle: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),
  inserveContactId: z.coerce
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
});

export const UpdateContactSchema = CreateContactSchema.partial()
  .omit({ customerId: true })
  .extend({
    id: z.string().trim().min(1, "Contactpersoon-ID is verplicht"),
  });

export const DeleteContactSchema = z.object({
  id: z.string().trim().min(1, "Contactpersoon-ID is verplicht"),
});

export type CreateContactInput = z.infer<typeof CreateContactSchema>;
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;
export type DeleteContactInput = z.infer<typeof DeleteContactSchema>;
