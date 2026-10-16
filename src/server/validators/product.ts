import { z } from "zod";
import { ProductTrack } from "@/types/enums";

/**
 * Trajectgeschiktheid van een product. Beperkte set toegestane waarden om
 * foutieve invoer te voorkomen; leeg/onbekend wordt geweigerd.
 */
export const ProductTrackSchema = z.nativeEnum(ProductTrack, {
  errorMap: () => ({
    message:
      'Kies een geldig traject: "Beide trajecten", "Alleen Sim-only datasimkaart" of "Alleen Nieuwe tracker met simkaart".',
  }),
});

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
  // Verplicht met standaard "Beide trajecten" zodat bestaande/nieuwe producten
  // niet onbedoeld uit een traject verdwijnen.
  track: ProductTrackSchema.default(ProductTrack.BOTH),
});

export const UpdateProductSchema = CreateProductSchema.partial();

export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
