"use client";

import { useState } from "react";
import { SimList } from "./sim-list";
import { SimCsvImportDialog } from "./sim-csv-import";
import type { SIM } from "@prisma/client";

type SimListClientProps = {
  sims: SIM[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImport: boolean;
  canExport: boolean;
};

export function SimListWithImport(props: SimListClientProps) {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <SimList {...props} onImportClick={() => setImportOpen(true)} />
      {props.canImport ? (
        <SimCsvImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      ) : null}
    </>
  );
}
