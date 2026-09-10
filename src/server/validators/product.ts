import { z } from "zod";

export const CreateProductSchema = z.object({
  name: z.string().trim().min(1, "Productnaam is verplicht"),
  productCode: z.string().trim().min(1, "Productcode is verplicht"),
  description: z.string().trim().nullable().optional(),
  monthlyPrice: z.coerce
    .number({ invalid_type_error: "Maandprijs moet een getal zijn" })
    .nonnegative("Maandprijs mag niet negatief zijn"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, "Valuta moet 3 letters zijn (ISO 4217)")
    .optional(),
  btwPercentage: z.coerce.number().min(0).max(100).optional(),
  inserveArticleId: z.coerce.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const UpdateProductSchema = CreateProductSchema.partial();

export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
