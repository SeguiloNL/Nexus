import { z } from "zod";
import { isValidImei, normalizeImei, normalizeSerialNumber } from "@/lib/validation";
import { TrackerStatus } from "@/types/enums";

const BaseTrackerFields = z.object({
  serialNumber: z
    .string()
    .trim()
    .min(1, "Serienummer is verplicht")
    .transform((v) => normalizeSerialNumber(v)),
  imei: z
    .string()
    .trim()
    .min(1, "IMEI is verplicht")
    .transform((v) => normalizeImei(v))
    .refine(isValidImei, { message: "Ongeldige IMEI (Luhn-check faalt)" })
    .refine((v) => v.length >= 14, {
      message: "IMEI moet minimaal 14 cijfers bevatten",
    }),
  brand: z.string().trim().min(1, "Merk is verplicht"),
  model: z.string().trim().min(1, "Model is verplicht"),
  hardwareType: z.string().trim().nullable().optional(),
  firmwareVersion: z.string().trim().nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  supplier: z.string().trim().nullable().optional(),
  status: z.nativeEnum(TrackerStatus).optional(),
  notes: z.string().trim().nullable().optional(),
});

export const CreateTrackerSchema = BaseTrackerFields;

export const UpdateTrackerSchema = BaseTrackerFields.omit({
  imei: true,
  serialNumber: true,
})
  .partial()
  .extend({
    imei: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? normalizeImei(v) : undefined))
      .refine((v) => v === undefined || isValidImei(v), {
        message: "Ongeldige IMEI (Luhn-check faalt)",
      }),
    serialNumber: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? normalizeSerialNumber(v) : undefined)),
  });

export type CreateTrackerInput = z.infer<typeof CreateTrackerSchema>;
export type UpdateTrackerInput = z.infer<typeof UpdateTrackerSchema>;
