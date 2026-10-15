import { z } from "zod";
import { DataUnit, CustomerType } from "@/types/enums";

export const CreateDataPlanSchema = z.object({
  name: z.string().trim().min(1, "Naam is verplicht"),
  description: z.string().trim().nullable().optional(),
  dataAmountBytes: z.union([
    z.coerce
      .bigint({ invalid_type_error: "Databundel moet een getal zijn" })
      .refine((v) => v >= 0, "Databundel mag niet negatief zijn"),
    z.null(),
  ]).optional(),
  dataAmountDisplayUnit: z.nativeEnum(DataUnit).nullable().optional(),
  validityDays: z.coerce
    .number({ invalid_type_error: "Geldigheidsdagen moet een getal zijn" })
    .int()
    .positive("Geldigheidsdagen moeten groter dan 0 zijn")
    .nullable()
    .optional(),
  validityBillingCycle: z.string().nullable().optional(),
  monthlyPrice: z.union([
    z.coerce
      .number({ invalid_type_error: "Maandprijs moet een getal zijn" })
      .nonnegative("Maandprijs mag niet negatief zijn"),
    z.null(),
  ]).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, "Valuta moet 3 letters zijn (ISO 4217)")
    .optional(),
  btwPercentage: z.coerce
    .number({ invalid_type_error: "BTW moet een getal zijn" })
    .min(0, "BTW moet minimaal 0% zijn")
    .max(100, "BTW mag maximaal 100% zijn")
    .nullable()
    .optional(),
  provider: z.string().trim().max(150, "Provider maximaal 150 tekens").nullable().optional(),
  providerPlanRef: z.string().trim().max(200, "Provider plan-ref maximaal 200 tekens").nullable().optional(),
  providerOfferRef: z.string().trim().max(200, "Provider offer-ref maximaal 200 tekens").nullable().optional(),
  isActive: z.boolean().optional(),
  simOnlyAvailable: z.boolean().optional(),
  // Factureerbare productkoppeling (1-op-1). Leeg laten = nog niet factureerbaar.
  productId: z
    .union([z.string().trim().min(1), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" ? null : v)),
  // Targeting: leeg = beschikbaar voor alle regio's / klanttypes.
  targetRegions: z.array(z.string().trim().min(1)).optional(),
  targetCustomerTypes: z.array(z.nativeEnum(CustomerType)).optional(),
  // Optionele vervaldatum (null = geen vervaldatum). Let op: z.null() moet
  // vóór z.coerce.date() staan, anders wordt null gecoerced naar epoch (1970).
  availableUntil: z
    .preprocess(
      (v) => (v === "" ? null : v),
      z.union([z.null(), z.coerce.date()])
    )
    .optional(),
});

export const UpdateDataPlanSchema = CreateDataPlanSchema.partial();

export type CreateDataPlanInput = z.infer<typeof CreateDataPlanSchema>;
export type UpdateDataPlanInput = z.infer<typeof UpdateDataPlanSchema>;
