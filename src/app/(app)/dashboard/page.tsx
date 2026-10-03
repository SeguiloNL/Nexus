import { requireUser, canUserRole, redirectForbidden, type SessionUser } from "@/lib/auth/session";
import Link from "next/link";
import { permissionsMeaningful as rbacPermissionsMeaningful } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { ResourceType, RoleScope } from "@/types/enums";
import {
  CUSTOMER_SCOPE_RESOURCES,
  RESELLER_SCOPE_RESOURCES,
  PARTNER_SCOPE_RESOURCES,
  ALL_RESOURCE_TYPES,
} from "@/types/enums";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Cpu,
  CreditCard,
  LayoutDashboard,
  PackageCheck,
  PackageSearch,
  Server,
  ShieldAlert,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatCurrency,
  formatDate,
  formatIccid,
  formatImei,
} from "@/lib/formatters";

type StatTone = "emerald" | "amber" | "red" | "sky" | "slate";

type ScopeContext = {
  customerScopeCustomer: Record<string, unknown> | undefined;
  customerScopeSubscription: Record<string, unknown> | undefined;
  customerScopeVehicle: Record<string, unknown> | undefined;
  customerScopeAssignment: Record<string, unknown> | undefined;
  customerScopeActivation: Record<string, unknown> | undefined;
};

type DashboardTileExtra = (scope: ScopeContext) => Promise<React.ReactNode>;

/**
 * Declaratieve configuratie van alle Dashboard tegels.
 *
 * TEN ONDERHOUDE: Voor het toevoegen van een nieuwe tegel:
 *   1. Voeg een entry toe aan DASHBOARD_TILES met een unieke `key`,
 *      de `resource` waar `view`-rechten voor nodig zijn,
 *      en een `countQuery` die de teller ophaalt (ontvangt ScopeContext).
 *   2. De permissie-check en scope-whitelist gebeuren AUTOMATISCH op basis
 *      van `resource` veld. Laat dit veld dus NIET ontbreken.
 *   3. De `resource` moet overeenkomen met de pagina waar de tegel naar linkt,
 *      zodat sidebar en dashboard consistent zijn.
 *
 * Tegel ↔ ResourceType mapping:
 *   subscription   -> Actieve abonnementen, Pending activation
 *   tracker        -> Trackers op voorraad, Actieve trackers, Defecte trackers
 *   sim            -> SIMs op voorraad, Actieve SIMs
 *   activation_order -> Openstaande activaties, Mislukte activaties vandaag
 *   customer       -> Klanten
 *   vehicle        -> Voertuigen
 *   product        -> Actieve producten (alleen INTERNAL scope)
 */
type DashboardTile = {
  key: string;
  resource: ResourceType;
  title: string;
  icon: LucideIcon;
  tone: StatTone;
  href: string;
  countQuery: (scope: ScopeContext) => Promise<number>;
  extraQuery?: DashboardTileExtra;
};

const DASHBOARD_TILES: DashboardTile[] = [
  {
    key: "sub_active",
    resource: "subscription",
    title: "Actieve abonnementen",
    icon: CreditCard,
    tone: "emerald",
    href: "/subscriptions?status=ACTIVE",
    countQuery: (s) =>
      prisma.subscription.count({
        where: {
          deletedAt: null,
          status: "ACTIVE",
          ...s.customerScopeSubscription,
        },
      }),
    extraQuery: async (s) => {
      const raw: any = await prisma.subscription.aggregate({
        where: {
          deletedAt: null,
          status: "ACTIVE",
          ...s.customerScopeSubscription,
        },
        _sum: { monthlyPrice: true },
      });
      const amount = raw._sum?.monthlyPrice ? Number(raw._sum.monthlyPrice) : 0;
      return (
        <div className="text-xs text-emerald-600">
          {formatCurrency(String(amount))}/mnd
        </div>
      );
    },
  },
  {
    key: "sub_pending",
    resource: "subscription",
    title: "Pending activation",
    icon: ShieldAlert,
    tone: "amber",
    href: "/subscriptions?status=PENDING_ACTIVATION",
    countQuery: (s) =>
      prisma.subscription.count({
        where: {
          deletedAt: null,
          status: "PENDING_ACTIVATION",
          ...s.customerScopeSubscription,
        },
      }),
  },
  {
    key: "trk_stock",
    resource: "tracker",
    title: "Trackers op voorraad",
    icon: PackageCheck,
    tone: "sky",
    href: "/trackers?status=IN_STOCK",
    countQuery: (s) =>
      prisma.tracker.count({
        where: {
          deletedAt: null,
          status: "IN_STOCK",
          ...s.customerScopeAssignment,
        },
      }),
  },
  {
    key: "trk_active",
    resource: "tracker",
    title: "Actieve trackers",
    icon: Cpu,
    tone: "emerald",
    href: "/trackers?status=ACTIVE",
    countQuery: (s) =>
      prisma.tracker.count({
        where: {
          deletedAt: null,
          status: "ACTIVE",
          ...s.customerScopeAssignment,
        },
      }),
  },
  {
    key: "trk_defect",
    resource: "tracker",
    title: "Defecte trackers",
    icon: AlertTriangle,
    tone: "red",
    href: "/trackers?status=DEFECTIVE",
    countQuery: (s) =>
      prisma.tracker.count({
        where: {
          deletedAt: null,
          status: "DEFECTIVE",
          ...s.customerScopeAssignment,
        },
      }),
  },
  {
    key: "sim_stock",
    resource: "sim",
    title: "SIMs op voorraad",
    icon: Boxes,
    tone: "sky",
    href: "/sims?status=IN_STOCK",
    countQuery: (s) =>
      prisma.sIM.count({
        where: {
          deletedAt: null,
          status: "IN_STOCK",
          ...s.customerScopeAssignment,
        },
      }),
  },
  {
    key: "sim_active",
    resource: "sim",
    title: "Actieve SIMs",
    icon: Server,
    tone: "emerald",
    href: "/sims?status=ACTIVE",
    countQuery: (s) =>
      prisma.sIM.count({
        where: {
          deletedAt: null,
          status: "ACTIVE",
          ...s.customerScopeAssignment,
        },
      }),
  },
  {
    key: "act_open",
    resource: "activation_order",
    title: "Openstaande activaties",
    icon: Activity,
    tone: "amber",
    href: "/activations?status=READY",
    countQuery: (s) =>
      prisma.activationOrder.count({
        where: {
          status: { in: ["READY", "PROCESSING"] as unknown as undefined },
          ...s.customerScopeActivation,
        },
      }),
  },
  {
    key: "act_failed_today",
    resource: "activation_order",
    title: "Mislukte activaties vandaag",
    icon: AlertTriangle,
    tone: "red",
    href: "/activations?status=FAILED",
    countQuery: (s) =>
      prisma.activationOrder.count({
        where: {
          status: "FAILED" as unknown as undefined,
          failedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          ...s.customerScopeActivation,
        },
      }),
  },
  {
    key: "cust_count",
    resource: "customer",
    title: "Klanten",
    icon: Truck,
    tone: "slate",
    href: "/customers",
    countQuery: (s) =>
      prisma.customer.count({
        where: { deletedAt: null, ...s.customerScopeCustomer },
      }),
  },
  {
    key: "veh_count",
    resource: "vehicle",
    title: "Voertuigen",
    icon: Truck,
    tone: "slate",
    href: "/vehicles",
    countQuery: (s) =>
      prisma.vehicle.count({
        where: { deletedAt: null, ...s.customerScopeVehicle },
      }),
  },
  {
    key: "prod_active",
    resource: "product",
    title: "Actieve producten",
    icon: PackageSearch,
    tone: "slate",
    href: "/products",
    countQuery: () => prisma.product.count({ where: { isActive: true } }),
  },
];

function allowedResourcesForScope(scope: RoleScope | null | undefined): readonly ResourceType[] {
  switch (scope) {
    case "RESELLER":
      return RESELLER_SCOPE_RESOURCES;
    case "PARTNER":
      return PARTNER_SCOPE_RESOURCES;
    case "CUSTOMER":
      return CUSTOMER_SCOPE_RESOURCES;
    case "INTERNAL":
    default:
      return ALL_RESOURCE_TYPES;
  }
}

function localPermissionsMeaningful(bits: unknown): boolean {
  return rbacPermissionsMeaningful(
    bits as Parameters<typeof rbacPermissionsMeaningful>[0]
  );
}

/**
 * 3-traps permissie-resolutie voor view-toegang op een resource.
 * Identieke logica als sidebar.tsx resolveCan + scope-whitelist filter.
 *
 * Volgorde:
 *   1. PermissionBits (indien meaningful)
 *   2. roleId (string fallback via canUserRole prefix-matching)
 *   3. Legacy userRole (ADMIN/EMPLOYEE/VIEWER)
 * Plus: resources buiten de scope-whitelist worden altijd verborgen.
 */
function canViewResource(user: SessionUser, resource: ResourceType): boolean {
  const allowed = allowedResourcesForScope(user.roleScope);
  if (!allowed.includes(resource)) return false;

  const meaningful = localPermissionsMeaningful(user.permissions);
  if (meaningful) {
    return canUserRole(user.permissions, "view", resource);
  }
  if (user.roleId && canUserRole(user.roleId, "view", resource)) {
    return true;
  }
  return canUserRole(user.role ?? null, "view", resource);
}

export default async function DashboardPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "dashboard")) {
    redirectForbidden();
  }

  const customerIds = user.customerIds ?? [];
  const hasScope = customerIds.length > 0;

  const scopeContext: ScopeContext = {
    customerScopeCustomer: hasScope
      ? { id: { in: customerIds } }
      : undefined,
    customerScopeSubscription: hasScope
      ? { customerId: { in: customerIds } }
      : undefined,
    customerScopeVehicle: hasScope
      ? { customerId: { in: customerIds } }
      : undefined,
    customerScopeAssignment: hasScope
      ? {
          assignments: {
            some: { subscription: { customerId: { in: customerIds } } },
          },
        }
      : undefined,
    customerScopeActivation: hasScope
      ? {
          OR: [
            { customerId: { in: customerIds } },
            { subCustomerId: { in: customerIds } },
          ],
        }
      : undefined,
  };

  const visibleTiles = DASHBOARD_TILES.filter((t) =>
    canViewResource(user, t.resource)
  );

  type CountResults = Record<string, number>;
  type ExtraResults = Record<string, React.ReactNode>;

  const countEntries = visibleTiles.map(async (t) => {
    const value = await t.countQuery(scopeContext);
    return [t.key, value] as const;
  });

  const extraEntries = visibleTiles
    .filter((t) => t.extraQuery)
    .map(async (t) => {
      const node = await (t.extraQuery as DashboardTileExtra)(scopeContext);
      return [t.key, node] as const;
    });

  const [countPairs, extraPairs] = await Promise.all([
    Promise.all(countEntries),
    Promise.all(extraEntries),
  ]);

  const counts: CountResults = Object.fromEntries(countPairs);
  const extras: ExtraResults = Object.fromEntries(extraPairs);

  const canViewActivations = canViewResource(user, "activation_order");

  const recentActivations = canViewActivations
    ? await prisma.activationOrder.findMany({
        where: {
          status: "COMPLETED" as unknown as undefined,
          ...scopeContext.customerScopeActivation,
        },
        orderBy: { completedAt: "desc" as unknown as undefined },
        take: 10,
        include: {
          customer: { select: { id: true, companyName: true } },
          tracker: { select: { id: true, imei: true, serialNumber: true } },
          sim: { select: { id: true, iccid: true } },
          subscription: { select: { id: true, subscriptionNumber: true } },
        },
      })
    : [];

  const hasAnyTiles = visibleTiles.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-slate-500" />
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <p className="text-sm text-slate-500">
          Overzicht van actieve abonnementen, voorraad en openstaande
          activaties.
        </p>
      </div>

      {hasAnyTiles ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {visibleTiles.map((t) => {
            const Icon = t.icon;
            const value = counts[t.key] ?? 0;
            const extra = extras[t.key];
            return (
              <StatCard
                key={t.key}
                title={t.title}
                value={String(value)}
                icon={<Icon className="h-5 w-5" />}
                tone={t.tone}
                href={t.href}
                extra={extra}
              />
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <LayoutDashboard className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900">
              Geen tegels beschikbaar
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Je hebt toegang tot het Dashboard, maar er zijn nog geen
              onderdelen toegewezen. Neem contact op met je beheerder voor
              aanvullende rechten.
            </p>
          </CardContent>
        </Card>
      )}

      {canViewActivations ? (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Recente activaties</h2>
            <Link
              href="/activations"
              className="text-sm text-slate-500 underline-offset-4 hover:underline"
            >
              Alle activaties →
            </Link>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Order</th>
                      <th className="px-4 py-3">Klant</th>
                      <th className="px-4 py-3">Voltooid</th>
                      <th className="px-4 py-3">Tracker</th>
                      <th className="px-4 py-3">SIM</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivations.length ? (
                      recentActivations.map((o) => (
                        <tr key={o.id} className="border-t hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <Link
                              href={`/activations/${o.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {(o as { orderNumber: string }).orderNumber}
                            </Link>
                            {o.subscription ? (
                              <div className="text-xs text-slate-500 mt-0.5">
                                <Badge variant="secondary">
                                  {
                                    (o.subscription as { subscriptionNumber: string })
                                      .subscriptionNumber
                                  }
                                </Badge>
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {o.customer ? (
                              <Link
                                href={`/customers/${(o.customer as { id: string }).id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {(o.customer as { companyName: string }).companyName}
                              </Link>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {(o as { completedAt: Date | null }).completedAt
                              ? formatDate(
                                  (o as { completedAt: Date }).completedAt
                                )
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {o.tracker ? (
                              <div>
                                <Link
                                  href={`/trackers/${(o.tracker as { id: string }).id}`}
                                  className="font-medium underline-offset-4 hover:underline"
                                >
                                  {(o.tracker as { serialNumber: string }).serialNumber}
                                </Link>
                                <div className="font-mono text-xs text-slate-500">
                                  {formatImei(
                                    (o.tracker as { imei: string }).imei
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {o.sim ? (
                              <Link
                                href={`/sims/${(o.sim as { id: string }).id}`}
                                className="font-mono text-xs underline-offset-4 hover:underline"
                              >
                                {formatIccid((o.sim as { iccid: string }).iccid)}
                              </Link>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {o.subscription ? (
                              <Link
                                href={`/subscriptions/${(o.subscription as { id: string }).id}`}
                                className="text-xs text-slate-600 underline-offset-4 hover:underline"
                              >
                                Bekijk abonnement →
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-10 text-center text-sm text-slate-400"
                        >
                          Nog geen voltooide activaties. Start de{" "}
                          <Link
                            href="/activations/wizard"
                            className="underline-offset-4 hover:underline"
                          >
                            wizard
                          </Link>{" "}
                          om de eerste te maken.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  tone,
  href,
  extra,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  tone: StatTone;
  href: string;
  extra?: React.ReactNode;
}) {
  const tones = {
    emerald:
      "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50/70",
    amber:
      "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50/70",
    red: "bg-red-50 text-red-700 border-red-200 hover:bg-red-50/70",
    sky: "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-50/70",
    slate:
      "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-50/70",
  };
  const BadgeTone = {
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    sky: "bg-sky-100 text-sky-700",
    slate: "bg-slate-200 text-slate-700",
  } as const;
  return (
    <Link href={href}>
      <Card
        className={`border transition-colors cursor-pointer ${tones[tone]}`}
      >
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div className="text-xs font-medium uppercase tracking-wide opacity-80">
              {title}
            </div>
            <div
              className={`h-8 w-8 flex items-center justify-center rounded-md ${BadgeTone[tone]}`}
            >
              {icon}
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          {extra}
        </CardContent>
      </Card>
    </Link>
  );
}
