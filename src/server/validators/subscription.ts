import { z } from "zod";
import { BillingCycle, SubscriptionStatus } from "@/types/enums";

export const CreateSubscriptionSchema = z.object({
  subscriptionNumber: z.string().trim().optional(),
  customerId: z.string().trim().min(1, "Klant is verplicht"),
  productId: z.string().trim().min(1, "Product is verplicht"),
  startDate: z.coerce.date({ required_error: "Startdatum is verplicht" }),
  endDate: z.coerce.date().nullable().optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  monthlyPrice: z.coerce
    .number({ invalid_type_error: "Maandprijs moet een getal zijn" })
    .nonnegative("Maandprijs mag niet negatief zijn"),
  billingCycle: z.nativeEnum(BillingCycle).optional(),
  notes: z.string().trim().nullable().optional(),
});

export const UpdateSubscriptionSchema = CreateSubscriptionSchema.partial().omit({
  subscriptionNumber: true,
}).extend({
  subscriptionNumber: z.string().trim().optional(),
});

export const UpdateSubscriptionStatusSchema = z.object({
  status: z.nativeEnum(SubscriptionStatus, {
    message: "Ongeldige abonnementstatus",
  }),
  reason: z.string().trim().nullable().optional(),
});

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionSchema>;
export type UpdateSubscriptionStatusInput = z.infer<
  typeof UpdateSubscriptionStatusSchema
>;
