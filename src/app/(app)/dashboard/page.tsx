import {
  LayoutDashboard,
  Users,
  Box,
  CreditCard,
  Receipt,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PLACEHOLDER_STATS = [
  {
    label: "Actieve abonnementen",
    value: "-",
    icon: Receipt,
    href: "/subscriptions?status=ACTIVE",
    tone: "success",
  },
  {
    label: "Activaties open",
    value: "-",
    icon: ClipboardList,
    href: "/activations?status=READY",
    tone: "info",
  },
  {
    label: "Klanten",
    value: "-",
    icon: Users,
    href: "/customers",
    tone: "default",
  },
  {
    label: "Trackers op voorraad",
    value: "-",
    icon: Box,
    href: "/trackers?status=IN_STOCK",
    tone: "default",
  },
  {
    label: "Actieve trackers",
    value: "-",
    icon: CheckCircle2,
    href: "/trackers?status=ACTIVE",
    tone: "success",
  },
  {
    label: "Defecte trackers",
    value: "-",
    icon: AlertTriangle,
    href: "/trackers?status=DEFECTIVE",
    tone: "destructive",
  },
  {
    label: "SIMs op voorraad",
    value: "-",
    icon: CreditCard,
    href: "/sims?status=IN_STOCK",
    tone: "default",
  },
  {
    label: "Actieve SIMs",
    value: "-",
    icon: CreditCard,
    href: "/sims?status=ACTIVE",
    tone: "success",
  },
  {
    label: "Gefaald vandaag",
    value: "0",
    icon: Clock,
    href: "/activations?status=FAILED",
    tone: "destructive",
  },
];

const TONE_CLASS: Record<string, string> = {
  default: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-700",
  info: "bg-sky-100 text-sky-700",
  destructive: "bg-red-100 text-red-700",
};

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Overzicht van je Seguilo STM werkvoorraad.
          </p>
        </div>
        <div className="text-xs text-slate-400">
          <LayoutDashboard className="mr-1 inline h-3.5 w-3.5" />
          Dashboard stats laden zodra database is geseed.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLACEHOLDER_STATS.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {s.label}
                </CardTitle>
                <div className={`rounded-md p-1.5 ${TONE_CLASS[s.tone]}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s.value}</div>
                <CardDescription className="mt-1 text-xs">
                  <a
                    className="text-slate-500 underline-offset-4 hover:underline"
                    href={s.href}
                  >
                    Open lijst
                  </a>
                </CardDescription>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Laatste activaties</CardTitle>
          <CardDescription>
            Deze tabel wordt gevuld na de eerste geslaagde activaties.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-400">
            Nog geen activatieorders uitgevoerd.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
