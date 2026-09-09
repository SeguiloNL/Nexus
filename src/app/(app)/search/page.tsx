"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Users, UserRound, Cpu, CreditCard, Truck, Package, ListChecks, FileText, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CustomerStatusBadge,
  TrackerStatusBadge,
  SimStatusBadge,
  SubscriptionStatusBadge,
  ActivationOrderStatusBadge,
} from "@/components/ui/status-badges";
import { formatImei, formatIccid, formatLicensePlate } from "@/lib/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Hit =
  | { kind: "customer"; id: string; customerNumber: string; companyName: string; status: any }
  | { kind: "tracker"; id: string; serialNumber: string; imei: string; status: any }
  | { kind: "sim"; id: string; iccid: string; imsi: string; status: any }
  | { kind: "vehicle"; id: string; licensePlate: string | null; vin: string | null }
  | { kind: "product"; id: string; productCode: string; name: string }
  | { kind: "subscription"; id: string; subscriptionNumber: string; status: any }
  | { kind: "activation_order"; id: string; orderNumber: string; status: any }
  | { kind: "user"; id: string; name: string; email: string };

interface IndexData {
  customers: Hit[];
  trackers: Hit[];
  sims: Hit[];
  vehicles: Hit[];
  products: Hit[];
  subscriptions: Hit[];
  orders: Hit[];
  users: Hit[];
}

export default function GlobalSearchPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const q = sp?.get("q") ?? "";
  const [index, setIndex] = useState<IndexData | null>(null);
  const [query, setQuery] = useState(q);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/search/index.json`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIndex(data);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo<Hit[]>(() => {
    if (!index) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const all = [
      ...index.customers,
      ...index.trackers,
      ...index.sims,
      ...index.vehicles,
      ...index.products,
      ...index.subscriptions,
      ...index.orders,
      ...index.users,
    ];
    return all
      .filter((h) => {
        const hay = Object.values(h).map((v) => String(v ?? "")).join(" ").toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 50);
  }, [index, query]);

  const groups = useMemo(() => {
    const g: Record<string, Hit[]> = {};
    for (const h of results) {
      if (!g[h.kind]) g[h.kind] = [];
      g[h.kind].push(h);
    }
    return g;
  }, [results]);

  const kindLabels: Record<string, string> = {
    customer: "Klanten",
    tracker: "Trackers",
    sim: "SIM-kaarten",
    vehicle: "Voertuigen",
    product: "Producten",
    subscription: "Abonnementen",
    activation_order: "Activaties",
    user: "Gebruikers",
  };

  const kindIcons: Record<string, any> = {
    customer: Users,
    tracker: Cpu,
    sim: CreditCard,
    vehicle: Truck,
    product: Package,
    subscription: FileText,
    activation_order: ListChecks,
    user: UserRound,
  };

  const kindHref: Record<string, (id: string) => string> = {
    customer: (id) => `/customers/${id}`,
    tracker: (id) => `/trackers/${id}`,
    sim: (id) => `/sims/${id}`,
    vehicle: (id) => `/vehicles/${id}`,
    product: (id) => `/products/${id}`,
    subscription: (id) => `/subscriptions/${id}`,
    activation_order: (id) => `/activations/${id}`,
    user: () => `/users`,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Zoeken</h1>
        <p className="text-sm text-slate-500">
          Zoek in klanten, assets, activaties, abonnementen en gebruikers. (⌘K)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Zoekopdracht</CardTitle>
          <CardDescription>
            Voer een zoekterm in (min. 2 tekens aanbevolen).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Bijv. Van der Transport, TRK-00001, 893104..."
              className="pl-9 pr-9"
              autoFocus
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                onClick={() => setQuery("")}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {index ? (
        query.trim() ? (
          results.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <Badge variant="outline">
                  {results.length} resul
                  {results.length === 1 ? "taat" : "taten"}
                </Badge>
              </div>
              <Tabs defaultValue="all">
                <TabsList className="flex-wrap h-auto">
                  <TabsTrigger value="all">Alles ({results.length})</TabsTrigger>
                  {Object.entries(groups).map(([k, arr]) => (
                    <TabsTrigger key={k} value={k}>
                      {kindLabels[k] ?? k} ({arr.length})
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="all" className="mt-4 space-y-4">
                  {Object.entries(groups).map(([k, arr]) => (
                    <ResultGroup
                      key={k}
                      label={kindLabels[k] ?? k}
                      Icon={kindIcons[k] ?? Search}
                      hits={arr}
                      hrefFor={(id) => kindHref[k]?.(id) ?? "#"}
                      router={router}
                    />
                  ))}
                </TabsContent>
                {Object.keys(groups).map((k) => (
                  <TabsContent key={k} value={k} className="mt-4">
                    <ResultGroup
                      label={kindLabels[k] ?? k}
                      Icon={kindIcons[k] ?? Search}
                      hits={groups[k]}
                      hrefFor={(id) => kindHref[k]?.(id) ?? "#"}
                      router={router}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-slate-500">
                Geen resultaten voor &ldquo;{query}&rdquo;.
              </CardContent>
            </Card>
          )
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-slate-500">
              Voer een zoekterm in om te beginnen.
            </CardContent>
          </Card>
        )
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-slate-500">
            Zoekindex wordt geladen...
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultGroup({
  label,
  Icon,
  hits,
  hrefFor,
  router,
}: {
  label: string;
  Icon: any;
  hits: Hit[];
  hrefFor: (id: string) => string;
  router: any;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-slate-500" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {hits.map((h) => {
            const href = hrefFor(h.id);
            const { title, subtitle, badge } = formatHit(h);
            return (
              <li key={`${h.kind}-${h.id}`}>
                <Link
                  href={href}
                  className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50 rounded px-2 -mx-2"
                  onClick={() => router.push(href)}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{title}</div>
                    {subtitle ? (
                      <div className="truncate text-xs text-slate-500">
                        {subtitle}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0">{badge}</div>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function formatHit(h: Hit): { title: string; subtitle: string; badge: React.ReactNode } {
  switch (h.kind) {
    case "customer":
      return {
        title: h.companyName,
        subtitle: h.customerNumber,
        badge: <CustomerStatusBadge status={h.status} />,
      };
    case "tracker":
      return {
        title: h.serialNumber,
        subtitle: formatImei(h.imei),
        badge: <TrackerStatusBadge status={h.status} />,
      };
    case "sim":
      return {
        title: formatIccid(h.iccid),
        subtitle: h.imsi,
        badge: <SimStatusBadge status={h.status} />,
      };
    case "vehicle":
      return {
        title: h.licensePlate ? formatLicensePlate(h.licensePlate) : `VIN ${h.vin ?? "—"}`,
        subtitle: h.vin ?? "",
        badge: <Badge variant="outline">Voertuig</Badge>,
      };
    case "product":
      return {
        title: h.name,
        subtitle: h.productCode,
        badge: <Badge variant="outline">Product</Badge>,
      };
    case "subscription":
      return {
        title: h.subscriptionNumber,
        subtitle: "Abonnement",
        badge: <SubscriptionStatusBadge status={h.status} />,
      };
    case "activation_order":
      return {
        title: h.orderNumber,
        subtitle: "Activatie-order",
        badge: <ActivationOrderStatusBadge status={h.status} />,
      };
    case "user":
      return {
        title: h.name,
        subtitle: h.email,
        badge: <Badge variant="outline">Gebruiker</Badge>,
      };
  }
}
