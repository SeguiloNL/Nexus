import { z } from "zod";
import { CustomerStatus } from "@/types/enums";
import { validateEmail, validatePhone, validatePostalCode, validateKvkNr, validateBtwNr } from "@/lib/validation";

export const CreateCustomerSchema = z.object({
  customerNumber: z.string().trim().optional(),
  companyName: z.string().trim().min(1, "Bedrijfsnaam is verplicht"),
  parentCustomerId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  address: z.string().trim().nullable().optional(),
  postalCode: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine(
      (val) => !val || validatePostalCode(val, "NL"),
      "Ongeldige postcode (NL formaat: 1234AB)"
    ),
  city: z.string().trim().nullable().optional(),
  country: z.string().trim().nullable().optional(),
  contactPerson: z.string().trim().nullable().optional(),
  phone: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine(
      (val) => !val || validatePhone(val),
      "Ongeldig telefoonnummer"
    ),
  email: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine(
      (val) => !val || validateEmail(val),
      "Ongeldig e-mailadres"
    ),
  kvkNr: z
    .preprocess(
      (val) => {
        if (typeof val !== "string") return val;
        const stripped = val.replace(/\D/g, "");
        return stripped === "" ? null : stripped;
      },
      z.string().nullable().optional()
    )
    .refine(
      (val: string | null | undefined) => !val || validateKvkNr(val),
      "Ongeldig KvK-nummer (8 cijfers)"
    ),
  btwNr: z
    .preprocess(
      (val) => {
        if (typeof val !== "string") return val;
        const normalized = val.replace(/\s/g, "").toUpperCase();
        return normalized === "" ? null : normalized;
      },
      z.string().nullable().optional()
    )
    .refine(
      (val: string | null | undefined) => !val || validateBtwNr(val),
      "Ongeldig BTW-nummer (bijv. NL123456789B01)"
    ),
  inserveCompanyId: z.coerce.number().int().positive().nullable().optional(),
  status: z.nativeEnum(CustomerStatus).optional(),
  notes: z.string().trim().nullable().optional(),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial().omit({
  customerNumber: true,
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
