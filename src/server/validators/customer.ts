import { z } from "zod";
import { CustomerStatus } from "@/types/enums";
import { validateEmail, validatePhone, validatePostalCode } from "@/lib/validation";

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
  status: z.nativeEnum(CustomerStatus).optional(),
  notes: z.string().trim().nullable().optional(),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial().omit({
  customerNumber: true,
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
