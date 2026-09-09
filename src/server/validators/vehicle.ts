import { z } from "zod";
import {
  normalizeVin,
  normalizeLicensePlate,
  isValidVin,
} from "@/lib/validation";

export const CreateVehicleSchema = z.object({
  customerId: z.string().trim().min(1, "Klant is verplicht"),
  licensePlate: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null))
    .transform((v) => (v ? normalizeLicensePlate(v) : null)),
  vin: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null))
    .transform((v) => (v ? normalizeVin(v) : null))
    .refine((v) => v === null || v === undefined || isValidVin(v), {
      message:
        "Ongeldig VIN (17 karakters, geen I, O of Q)",
    }),
  brand: z.string().trim().nullable().optional(),
  model: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

export const UpdateVehicleSchema = CreateVehicleSchema.partial();

export type CreateVehicleInput = z.infer<typeof CreateVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof UpdateVehicleSchema>;
