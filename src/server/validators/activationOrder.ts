import { z } from "zod";
import {
  ActivationOrderStatus,
  BillingCycle,
} from "@/types/enums";

export const CreateActivationOrderSchema = z.object({
  orderNumber: z.string().trim().optional(),
  customerId: z.string().trim().min(1, "Klant is verplicht"),
  subCustomerId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  productId: z.string().trim().min(1, "Product is verplicht"),
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

export const UpdateActivationOrderSchema =
  CreateActivationOrderSchema.partial().omit({ orderNumber: true });

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
