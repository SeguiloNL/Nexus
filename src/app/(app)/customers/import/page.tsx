import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { CustomerImportClient } from "./_components/customer-import-client";
import { InserveCustomerImportClient } from "./_components/inserve-customer-import-client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function CustomersImportPage() {
  const user = await requireUser();
  const canCsvImport = canUserRole(user.permissions, "import", "customer");
  const canInserveImport =
    canUserRole(user.permissions, "import_from_inserve", "customer") &&
    (user as any).roleScope === "INTERNAL";

  if (!canCsvImport && !canInserveImport) {
    redirectForbidden();
  }

  const defaultTab = canInserveImport ? "inserve" : "csv";

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/customers">
            <ArrowLeft className="mr-2 h-4 w-4" /> Terug naar klanten
          </Link>
        </Button>
      </div>
      {canCsvImport && canInserveImport ? (
        <Tabs defaultValue={defaultTab}>
          <TabsList className="grid w-full grid-cols-2">
            {canInserveImport && (
              <TabsTrigger value="inserve">Uit Inserve</TabsTrigger>
            )}
            {canCsvImport && <TabsTrigger value="csv">CSV bestand</TabsTrigger>}
          </TabsList>
          {canInserveImport && (
            <TabsContent value="inserve">
              <InserveCustomerImportClient />
            </TabsContent>
          )}
          {canCsvImport && (
            <TabsContent value="csv">
              <CustomerImportClient />
            </TabsContent>
          )}
        </Tabs>
      ) : canInserveImport ? (
        <InserveCustomerImportClient />
      ) : (
        <CustomerImportClient />
      )}
    </div>
  );
}
