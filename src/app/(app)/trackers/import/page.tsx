import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac";
import { TrackerImportClient } from "./_components/tracker-import-client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function TrackersImportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  requirePermission(session.user.role, "import", "tracker");

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/trackers">
            <ArrowLeft className="mr-2 h-4 w-4" /> Terug naar trackers
          </Link>
        </Button>
      </div>
      <TrackerImportClient />
    </div>
  );
}
