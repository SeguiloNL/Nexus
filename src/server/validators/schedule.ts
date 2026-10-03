import { z } from "zod";
import { SyncFrequency, SyncJobId } from "@/types/enums";

export const SaveSyncScheduleSchema = z
  .object({
    jobId: z.nativeEnum(SyncJobId),
    enabled: z.boolean(),
    frequency: z.nativeEnum(SyncFrequency),
    hour: z
      .number({ coerce: true })
      .int()
      .min(0, "Uur moet tussen 0 en 23 liggen.")
      .max(23, "Uur moet tussen 0 en 23 liggen."),
    minute: z
      .number({ coerce: true })
      .int()
      .min(0, "Minuut moet tussen 0 en 59 liggen.")
      .max(59, "Minuut moet tussen 0 en 59 liggen."),
    dayOfWeek: z
      .number({ coerce: true })
      .int()
      .min(0, "Dag van week: 0 (zo) t/m 6 (za).")
      .max(6, "Dag van week: 0 (zo) t/m 6 (za).")
      .optional()
      .nullable(),
    dayOfMonth: z
      .number({ coerce: true })
      .int()
      .min(1, "Dag van maand: 1 t/m 31.")
      .max(31, "Dag van maand: 1 t/m 31 (31 = laatste dag).")
      .optional()
      .nullable(),
    timezone: z
      .string()
      .trim()
      .default("Europe/Amsterdam")
      .refine((tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "Ongeldige tijdzone."),
    comment: z.string().trim().max(255).optional().nullable(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.frequency === SyncFrequency.WEEKLY && (cfg.dayOfWeek == null || cfg.dayOfWeek < 0 || cfg.dayOfWeek > 6)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bij Wekelijks moet dag van de week (0–6) opgegeven worden.",
        path: ["dayOfWeek"],
      });
    }
    if (cfg.frequency === SyncFrequency.MONTHLY && (cfg.dayOfMonth == null || cfg.dayOfMonth < 1 || cfg.dayOfMonth > 31)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bij Maandelijks moet dag van de maand (1–31) opgegeven worden.",
        path: ["dayOfMonth"],
      });
    }
    if (cfg.frequency === SyncFrequency.HOURLY && (cfg.minute < 0 || cfg.minute > 59)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bij per uur moet een geldige minuut (0–59) opgegeven worden.",
        path: ["minute"],
      });
    }
  });

export const ResetSyncScheduleSchema = z.object({
  jobId: z.nativeEnum(SyncJobId),
});

export const TriggerSyncJobSchema = z.object({
  jobId: z.nativeEnum(SyncJobId),
  force: z.boolean().default(true),
});

export type SaveSyncScheduleInput = z.infer<typeof SaveSyncScheduleSchema>;
export type ResetSyncScheduleInput = z.infer<typeof ResetSyncScheduleSchema>;
export type TriggerSyncJobInput = z.infer<typeof TriggerSyncJobSchema>;
