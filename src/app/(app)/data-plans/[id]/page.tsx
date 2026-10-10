import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Edit,
  Info,
  History,
  AlertTriangle,
  Database,
  Trash2,
  CreditCard,
  Shield,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataPlanForm } from "../_components/data-plan-form";
import { formatDate, formatCurrency } from "@/lib/formatters";
import { formatDataBundle } from "@/server/services/data-plan.service";
import { findDataPlanById } from "@/server/services/data-plan.service";
import { updateDataPlanAction } from "../actions";

// Client component for the delete action with confirmation.
import { DeleteDataPlanButton } from "../_components/delete-data-plan-button";

function formatValidity(plan: {
  validityDays: number | null;
  validityBillingCycle: string | null;
}): string {
  if (plan.validityDays != null) return `${plan.validityDays} dag(en)`;
  if (plan.validityBillingCycle) {
    const cycle = String(plan.validityBillingCycle).toLowerCase();
    const map: Record<string, string> = {
      weekly: "Per week",
      biweekly: "Per 2 weken",
      monthly: "Per maand",
      quarterly: "Per kwartaal",
      biannual: "Per halfjaar",
      annual: "Per jaar",
    };
    return map[cycle] ?? `Per ${cycle}`;
  }
  return "Onbeperkt / doorlopend";
}

export default async function DataPlanDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "data_plan")) {
    redirectForbidden();
  }

  const plan = await findDataPlanById(params.id);
  if (!plan) notFound();

  const canEdit = canUserRole(user.permissions, "edit", "data_plan");
  const canDelete = canUserRole(user.permissions, "delete", "data_plan");

  const planForForm = {
    ...plan,
    monthlyPrice: plan.monthlyPrice != null ? Number(plan.monthlyPrice) : null,
    btwPercentage: plan.btwPercentage != null ? Number(plan.btwPercentage) : null,
    dataAmountBytes: plan.dataAmountBytes,
  };

  const updateAction: any = async (prev: any, formData: FormData) =>
    updateDataPlanAction(params.id, prev, formData);

  const countAo = plan._count?.activationOrders ?? 0;
  const countSub = plan._count?.subscriptions ?? 0;
  const countSim = plan._count?.sims ?? 0;
  const hasLinks = countAo > 0 || countSub > 0 || countSim > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/data-plans">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Database className="h-5 w-5 text-slate-500" />
              <h1 className="text-2xl font-bold tracking-tight">
                {plan.name}
              </h1>
              {plan.isActive ? (
                <Badge variant="success">Actief</Badge>
              ) : (
                <Badge variant="muted">Inactief</Badge>
              )}
              {plan.simOnlyAvailable ? (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  Sim-only
                </Badge>
              ) : null}
            </div>
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <span>
                {formatDataBundle(plan.dataAmountBytes, plan.dataAmountDisplayUnit)}
              </span>
              <span>·</span>
              <span>{formatValidity(plan)}</span>
              {plan.monthlyPrice != null ? (
                <>
                  <span>·</span>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(String(plan.monthlyPrice), plan.currency ?? "EUR")} / mnd
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit ? (
            <Button asChild>
              <Link href="#edit">
                <Edit className="h-4 w-4" /> Bewerken
              </Link>
            </Button>
          ) : null}
          {canDelete ? (
            <DeleteDataPlanButton
              planId={plan.id}
              planName={plan.name}
              disabled={hasLinks}
            />
          ) : null}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <Info className="mr-1.5 h-4 w-4" /> Overzicht
          </TabsTrigger>
          {canEdit ? (
            <TabsTrigger value="edit">
              <Edit className="mr-1.5 h-4 w-4" /> Bewerken
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="usage">
            <Sparkles className="mr-1.5 h-4 w-4" /> Gebruik
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" /> Geschiedenis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Omschrijving</CardTitle>
              </CardHeader>
              <CardContent>
                {plan.description ? (
                  <p className="whitespace-pre-wrap text-sm text-slate-700">
                    {plan.description}
                  </p>
                ) : (
                  <div className="text-sm text-slate-400">
                    Geen omschrijving.
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>Technische gegevens.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Databundel</span>
                  <span className="font-medium tabular-nums">
                    {formatDataBundle(plan.dataAmountBytes, plan.dataAmountDisplayUnit)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Geldigheid</span>
                  <span className="font-medium">{formatValidity(plan)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Prijs / mnd</span>
                  <span className="font-medium tabular-nums">
                    {plan.monthlyPrice != null
                      ? formatCurrency(String(plan.monthlyPrice), plan.currency ?? "EUR")
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">BTW %</span>
                  <span className="tabular-nums font-medium">
                    {plan.btwPercentage != null ? `${Number(plan.btwPercentage)}%` : "—"}
                  </span>
                </div>
                <div className="my-2 h-px bg-slate-100" />
                <div className="flex justify-between">
                  <span className="text-slate-500">Provider</span>
                  <span className="font-medium">{plan.provider ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Plan-ref</span>
                  <span className="font-mono text-xs">
                    {plan.providerPlanRef ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Offer-ref</span>
                  <span className="font-mono text-xs">
                    {plan.providerOfferRef ?? "—"}
                  </span>
                </div>
                <div className="my-2 h-px bg-slate-100" />
                <div className="flex justify-between">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span>{formatDate(plan.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bijgewerkt</span>
                  <span>{formatDate(plan.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" id="edit" className="mt-6">
            <DataPlanForm
              mode="edit"
              dataPlanId={plan.id}
              initial={planForForm as any}
              action={updateAction}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="usage" className="mt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-slate-500" />
                  Activeringsorders
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">{countAo}</div>
                <div className="text-xs text-slate-500">
                  Aantal orders met dit plan.
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4 text-slate-500" />
                  Abonnementen
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">{countSub}</div>
                <div className="text-xs text-slate-500">
                  Actieve abonnementen met dit plan.
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-slate-500" />
                  SIM-kaarten
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">{countSim}</div>
                <div className="text-xs text-slate-500">
                  SIM-kaarten met dit plan toegewezen.
                </div>
              </CardContent>
            </Card>
          </div>
          {hasLinks ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Dit dataplan is reeds in gebruik. Definitief verwijderen is onmogelijk;
                deactiveer het plan om gebruik in nieuwe bestellingen te stoppen.
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Wijzigingsgeschiedenis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                <History className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>Auditlog (entityType=data_plan) — wordt via de Auditlog module ontsloten.</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
