import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PermissionError } from "@/lib/rbac";
import { canUserRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Cpu,
  CreditCard,
  LayoutDashboard,
  PackageCheck,
  PackageSearch,
  Server,
  ShieldAlert,
  Truck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  formatCurrency,
  formatDate,
  formatIccid,
  formatImei,
} from "@/lib/formatters";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "dashboard")) {
    throw new PermissionError("Je hebt geen toegang tot het dashboard.");
  }

  const counts = await Promise.all([
    prisma.subscription.count({
      where: { deletedAt: null, status: "ACTIVE" },
    }),
    prisma.subscription.count({
      where: { deletedAt: null, status: "PENDING_ACTIVATION" },
    }),
    prisma.tracker.count({
      where: { deletedAt: null, status: "IN_STOCK" },
    }),
    prisma.tracker.count({
      where: { deletedAt: null, status: "ACTIVE" },
    }),
    prisma.tracker.count({
      where: { deletedAt: null, status: "DEFECTIVE" },
    }),
    prisma.sIM.count({
      where: { deletedAt: null, status: "IN_STOCK" },
    }),
    prisma.sIM.count({
      where: { deletedAt: null, status: "ACTIVE" },
    }),
    prisma.activationOrder.count({
      where: { status: { in: ["READY", "PROCESSING"] as any } },
    }),
    prisma.activationOrder.count({
      where: { status: "FAILED" as any, failedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    prisma.customer.count({ where: { deletedAt: null } }),
    prisma.vehicle.count({ where: { deletedAt: null } }),
    prisma.product.count({ where: { isActive: true } }),
  ]);

  const recentActivations = await prisma.activationOrder.findMany({
    where: { status: "COMPLETED" as any },
    orderBy: { completedAt: "desc" as any },
    take: 10,
    include: {
      customer: { select: { id: true, companyName: true } },
      tracker: { select: { id: true, imei: true, serialNumber: true } },
      sim: { select: { id: true, iccid: true } },
      subscription: { select: { id: true, subscriptionNumber: true } },
    },
  });

  const monthlyRevenueRaw: any = await prisma.subscription.aggregate({
    where: { deletedAt: null, status: "ACTIVE" },
    _sum: { monthlyPrice: true },
  });
  const activeRevenue = monthlyRevenueRaw._sum.monthlyPrice
    ? Number(monthlyRevenueRaw._sum.monthlyPrice)
    : 0;

  const [
    activeSubs,
    pendingSubs,
    trackersStock,
    trackersActive,
    trackersDefect,
    simsStock,
    simsActive,
    openOrders,
    failedToday,
    customersCount,
    vehiclesCount,
    productsCount,
  ] = counts;

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        <StatCard
          title="Actieve abonnementen"
          value={String(activeSubs)}
          icon={<CreditCard className="h-5 w-5" />}
          tone="emerald"
          href="/subscriptions?status=ACTIVE"
          extra={
            <div className="text-xs text-emerald-600">
              {formatCurrency(String(activeRevenue))}
              /mnd
            </div>
          }
        />
        <StatCard
          title="Pending activation"
          value={String(pendingSubs)}
          icon={<ShieldAlert className="h-5 w-5" />}
          tone="amber"
          href="/subscriptions?status=PENDING_ACTIVATION"
        />
        <StatCard
          title="Trackers op voorraad"
          value={String(trackersStock)}
          icon={<PackageCheck className="h-5 w-5" />}
          tone="sky"
          href="/trackers?status=IN_STOCK"
        />
        <StatCard
          title="Actieve trackers"
          value={String(trackersActive)}
          icon={<Cpu className="h-5 w-5" />}
          tone="emerald"
          href="/trackers?status=ACTIVE"
        />
        <StatCard
          title="Defecte trackers"
          value={String(trackersDefect)}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="red"
          href="/trackers?status=DEFECTIVE"
        />
        <StatCard
          title="SIMs op voorraad"
          value={String(simsStock)}
          icon={<Boxes className="h-5 w-5" />}
          tone="sky"
          href="/sims?status=IN_STOCK"
        />
        <StatCard
          title="Actieve SIMs"
          value={String(simsActive)}
          icon={<Server className="h-5 w-5" />}
          tone="emerald"
          href="/sims?status=ACTIVE"
        />
        <StatCard
          title="Openstaande activaties"
          value={String(openOrders)}
          icon={<Activity className="h-5 w-5" />}
          tone="amber"
          href="/activations?status=READY"
        />
        <StatCard
          title="Mislukte activaties vandaag"
          value={String(failedToday)}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="red"
          href="/activations?status=FAILED"
        />
        <StatCard
          title="Klanten"
          value={String(customersCount)}
          icon={<Truck className="h-5 w-5" />}
          tone="slate"
          href="/customers"
        />
        <StatCard
          title="Voertuigen"
          value={String(vehiclesCount)}
          icon={<Truck className="h-5 w-5" />}
          tone="slate"
          href="/vehicles"
        />
        <StatCard
          title="Actieve producten"
          value={String(productsCount)}
          icon={<PackageSearch className="h-5 w-5" />}
          tone="slate"
          href="/products"
        />
      </div>

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
                            {o.orderNumber}
                          </Link>
                          {o.subscription ? (
                            <div className="text-xs text-slate-500 mt-0.5">
                              <Badge variant="secondary">
                                {o.subscription.subscriptionNumber}
                              </Badge>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {o.customer ? (
                            <Link
                              href={`/customers/${o.customer.id}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {o.customer.companyName}
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {o.completedAt ? formatDate(o.completedAt) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {o.tracker ? (
                            <div>
                              <Link
                                href={`/trackers/${o.tracker.id}`}
                                className="font-medium underline-offset-4 hover:underline"
                              >
                                {o.tracker.serialNumber}
                              </Link>
                              <div className="font-mono text-xs text-slate-500">
                                {formatImei(o.tracker.imei)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {o.sim ? (
                            <Link
                              href={`/sims/${o.sim.id}`}
                              className="font-mono text-xs underline-offset-4 hover:underline"
                            >
                              {formatIccid(o.sim.iccid)}
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {o.subscription ? (
                            <Link
                              href={`/subscriptions/${o.subscription.id}`}
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
                        Nog geen voltooide activaties. Start de <Link href="/activations/wizard" className="underline-offset-4 hover:underline">wizard</Link> om de eerste te maken.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
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
  tone: "emerald" | "amber" | "red" | "sky" | "slate";
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
            <div className={`h-8 w-8 flex items-center justify-center rounded-md ${BadgeTone[tone]}`}>
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
