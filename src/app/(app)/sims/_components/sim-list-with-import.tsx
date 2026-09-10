"use client";

import { SimList } from "./sim-list";
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
  return <SimList {...props} />;
}
