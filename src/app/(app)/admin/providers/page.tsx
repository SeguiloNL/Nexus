import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, Boxes, AlertTriangle } from "lucide-react";
import { listProvidersAction } from "./actions";
import { ProviderManager } from "./_components/provider-list";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Leveranciers — Beheer",
};

export default async function ProvidersAdminPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "setting")) {
    if (!canUserRole(user.permissions, "edit", "setting")) {
      redirectForbidden();
    }
  }
  const canEdit = canUserRole(user.permissions, "edit", "setting");

  const { items: providers } = await listProvidersAction();

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Boxes className="h-6 w-6 text-muted-foreground" />
            SIM-kaart Leveranciers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Beheer de actieve simkaartleveranciers, hun API-inloggegevens en
            verbindingsstatus. Alleen zichtbaar voor bevoegde beheerders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">
              <Info className="h-4 w-4 mr-2" />
              Naar instellingen
            </Link>
          </Button>
        </div>
      </header>

      <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-blue-800 dark:text-blue-200">
            <Info className="h-4 w-4" />
            Achtergrond
          </CardTitle>
          <CardDescription className="text-blue-700/80 dark:text-blue-200/70">
            Deze pagina maakt deel uit van het <strong>modulaire
            leverancierssysteem</strong>. Elke leverancier is een eigen adapter:
            activeer enkel de leveranciers die u gebruikt. Bestaande
            SIM-kaarten en instellingen worden nooit automatisch verwijderd.
            Simhuis is standaard actief en blijft behouden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Totaal modules</div>
              <div className="mt-1 text-lg font-semibold">{providers.length}</div>
            </div>
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Geconfigureerd</div>
              <div className="mt-1 text-lg font-semibold">
                {providers.filter((p) => p.isConfigured).length}
              </div>
            </div>
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Actief</div>
              <div className="mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                {providers.filter((p) => p.isActivated).length}
              </div>
            </div>
            <div className="rounded-md border bg-background/60 p-3">
              <div className="text-xs text-muted-foreground">Verbonden</div>
              <div className="mt-1 text-lg font-semibold">
                {providers.filter((p) => p.isConnected).length}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {providers.some((p) => p.isActivated && !p.isConnected) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong>Controleer verbindingsstatus.</strong> Een of meer actieve
            leveranciers hebben momenteel geen succesvolle laatste verbindingstest.
            Nieuwe API-aanroepen kunnen mislukken.
          </div>
        </div>
      )}

      <ProviderManager initialProviders={providers} canEdit={canEdit} />
    </div>
  );
}
