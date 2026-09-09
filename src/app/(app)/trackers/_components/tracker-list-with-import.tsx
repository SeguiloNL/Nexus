"use client";

import { useState } from "react";
import { TrackerList } from "./tracker-list";
import { TrackerCsvImportDialog } from "./tracker-csv-import";
import type { Tracker } from "@prisma/client";

type TrackerListClientProps = {
  trackers: Tracker[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImport: boolean;
};

export function TrackerListWithImport(props: TrackerListClientProps) {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <TrackerList {...props} onImportClick={() => setImportOpen(true)} />
      {props.canImport ? (
        <TrackerCsvImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      ) : null}
    </>
  );
}
