import { z } from "zod";
import { TrackerStatus, SimStatus, AssignmentReason } from "@/types/enums";

export const AssignTrackerSchema = z.object({
  subscriptionId: z.string().trim().min(1, "Abonnement is verplicht"),
  trackerId: z.string().trim().min(1, "Tracker is verplicht"),
  vehicleId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  reason: z.nativeEnum(AssignmentReason).optional(),
});

export const UnassignTrackerSchema = z.object({
  trackerId: z.string().trim().min(1, "Tracker is verplicht"),
  newTrackerStatus: z.nativeEnum(TrackerStatus).optional(),
  reason: z.nativeEnum(AssignmentReason).optional(),
});

export const ReplaceTrackerSchema = z.object({
  subscriptionId: z.string().trim().min(1, "Abonnement is verplicht"),
  oldTrackerId: z.string().trim().min(1, "Oude tracker is verplicht"),
  newTrackerId: z.string().trim().min(1, "Nieuwe tracker is verplicht"),
  oldTrackerDisposition: z.nativeEnum(TrackerStatus, {
    required_error: "Reden van oude tracker is verplicht",
  }),
  reason: z.string().trim().nullable().optional(),
}).refine((d) => d.oldTrackerId !== d.newTrackerId, {
  message: "Nieuwe tracker mag niet hetzelfde zijn als de oude tracker",
  path: ["newTrackerId"],
});

export const AssignSimSchema = z.object({
  subscriptionId: z.string().trim().min(1, "Abonnement is verplicht"),
  simId: z.string().trim().min(1, "SIM is verplicht"),
  reason: z.nativeEnum(AssignmentReason).optional(),
});

export const UnassignSimSchema = z.object({
  simId: z.string().trim().min(1, "SIM is verplicht"),
  newSimStatus: z.nativeEnum(SimStatus).optional(),
  reason: z.nativeEnum(AssignmentReason).optional(),
});

export const ReplaceSimSchema = z.object({
  subscriptionId: z.string().trim().min(1, "Abonnement is verplicht"),
  oldSimId: z.string().trim().min(1, "Oude SIM is verplicht"),
  newSimId: z.string().trim().min(1, "Nieuwe SIM is verplicht"),
  oldSimDisposition: z.nativeEnum(SimStatus, {
    required_error: "Reden van oude SIM is verplicht",
  }),
  reason: z.string().trim().nullable().optional(),
}).refine((d) => d.oldSimId !== d.newSimId, {
  message: "Nieuwe SIM mag niet hetzelfde zijn als de oude SIM",
  path: ["newSimId"],
});

export type AssignTrackerInput = z.infer<typeof AssignTrackerSchema>;
export type UnassignTrackerInput = z.infer<typeof UnassignTrackerSchema>;
export type ReplaceTrackerInput = z.infer<typeof ReplaceTrackerSchema>;
export type AssignSimInput = z.infer<typeof AssignSimSchema>;
export type UnassignSimInput = z.infer<typeof UnassignSimSchema>;
export type ReplaceSimInput = z.infer<typeof ReplaceSimSchema>;
