import { z } from "zod";

export const InserveSettingsSchema = z.object({
  subdomain: z
    .string()
    .trim()
    .min(1, "Inserve subdomein is verplicht")
    .regex(
      /^[a-z0-9-]+$/i,
      "Subdomein mag alleen letters, cijfers en streepjes bevatten"
    ),
  apiKey: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine(
      (val) => !val || val.length >= 8,
      "API-key lijkt te kort (minimaal 8 tekens)"
    )
    .transform((val) => (val === null || val === "" ? undefined : val)),
});

export type InserveSettingsInput = z.infer<typeof InserveSettingsSchema>;

export interface InserveSettings {
  subdomain: string;
  apiKey: string;
}

export interface InserveSettingsMasked {
  subdomain: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  source: "env" | "db" | "none";
}
