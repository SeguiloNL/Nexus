import { z } from "zod";
import {
  ActivationOrderStatus,
  ActivationOrderProductType,
  BillingCycle,
} from "@/types/enums";

const BaseActivationOrderSchema = z.object({
  orderNumber: z.string().trim().optional(),
  customerId: z.string().trim().min(1, "Klant is verplicht"),
  subCustomerId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  productId: z.string().trim().min(1, "Product is verplicht"),
  dataPlanId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  orderType: z.nativeEnum(ActivationOrderProductType).optional(),
  desiredStartDate: z.coerce.date({
    required_error: "Gewenste startdatum is verplicht",
  }),
  monthlyPrice: z.coerce
    .number({ invalid_type_error: "Maandprijs moet een getal zijn" })
    .nonnegative("Maandprijs mag niet negatief zijn"),
  billingCycle: z.nativeEnum(BillingCycle).optional(),
  trackerId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  simId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  vehicleId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  internalNotes: z.string().trim().nullable().optional(),
});

function applyOrderTypeRefinements<T extends z.ZodTypeAny>(
  schema: T,
): z.ZodEffects<T> {
  return schema.superRefine((val: any, ctx) => {
    const orderType = val.orderType ?? ActivationOrderProductType.TRACKER_WITH_SIM;
    if (orderType === ActivationOrderProductType.TRACKER_WITH_SIM) {
      if (!val.trackerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trackerId"],
          message: "Tracker is verplicht bij een tracker-activatie.",
        });
      }
    }
    if (orderType === ActivationOrderProductType.SIM_ONLY_DATA) {
      if (!val.dataPlanId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dataPlanId"],
          message: "Dataplan is verplicht bij een Sim-only bestelling.",
        });
      }
    }
    if (!val.simId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simId"],
        message: "SIM-kaart is verplicht.",
      });
    }
  }) as unknown as z.ZodEffects<T>;
}

export const CreateActivationOrderSchema =
  applyOrderTypeRefinements(BaseActivationOrderSchema);

const PartialActivationOrderSchema = BaseActivationOrderSchema.omit({
  orderNumber: true,
}).partial();
export const UpdateActivationOrderSchema =
  applyOrderTypeRefinements(PartialActivationOrderSchema);

export const ActivateOrderSchema = z.object({
  orderId: z.string().trim().min(1),
});

export const CancelOrderSchema = z.object({
  orderId: z.string().trim().min(1),
  reason: z.string().trim().nullable().optional(),
});

export type CreateActivationOrderInput = z.infer<
  typeof CreateActivationOrderSchema
>;
export type UpdateActivationOrderInput = z.infer<
  typeof UpdateActivationOrderSchema
>;
