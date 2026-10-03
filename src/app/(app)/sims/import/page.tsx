import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { SimImportClient } from "./_components/sim-import-client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function SimsImportPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "import", "sim")) {
    redirectForbidden();
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/sims">
            <ArrowLeft className="mr-2 h-4 w-4" /> Terug naar SIM-kaarten
          </Link>
        </Button>
      </div>
      <SimImportClient />
    </div>
  );
}
