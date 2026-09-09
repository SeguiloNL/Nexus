import { z } from "zod";
import {
  isValidIccid,
  normalizeIccid,
  normalizeMsisdn,
} from "@/lib/validation";
import { SimStatus } from "@/types/enums";

const BaseSimFields = z.object({
  iccid: z
    .string()
    .trim()
    .min(1, "ICCID is verplicht")
    .transform((v) => normalizeIccid(v))
    .refine(isValidIccid, {
      message:
        "Ongeldige ICCID (19-20 cijfers, beginnend met 89)",
    }),
  msisdn: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null))
    .transform((v) => (v ? normalizeMsisdn(v) : null)),
  imsi: z.string().trim().nullable().optional(),
  provider: z.string().trim().min(1, "Provider is verplicht"),
  simType: z.string().trim().nullable().optional(),
  apn: z.string().trim().nullable().optional(),
  status: z.nativeEnum(SimStatus).optional(),
  providerActivationDate: z.coerce.date().nullable().optional(),
  providerDeactivationDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

export const CreateSimSchema = BaseSimFields;

export const UpdateSimSchema = BaseSimFields.omit({
  iccid: true,
})
  .partial()
  .extend({
    iccid: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? normalizeIccid(v) : undefined))
      .refine((v) => v === undefined || isValidIccid(v), {
        message:
          "Ongeldige ICCID (19-20 cijfers, beginnend met 89)",
      }),
  });

export type CreateSimInput = z.infer<typeof CreateSimSchema>;
export type UpdateSimInput = z.infer<typeof UpdateSimSchema>;
