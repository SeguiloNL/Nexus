"use client";

import { TrackerList } from "./tracker-list";
import type { Tracker } from "@prisma/client";

type TrackerListClientProps = {
  trackers: Tracker[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImport: boolean;
  canExport: boolean;
};

export function TrackerListWithImport(props: TrackerListClientProps) {
  return <TrackerList {...props} />;
}
