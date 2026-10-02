"use client";

import Link from "next/link";
import { useState } from "react";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Input,
} from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeftRight, Plus, Edit3, Trash2, Eye, Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import type { AuditLog } from "@prisma/client";
import { formatDate } from "@/lib/formatters";

type AuditLogWithUser = AuditLog & {
  user?: { name: string | null; email: string };
};

interface AuditLogFilters {
  action?: string;
  entityType?: string;
  dateRange?: {
    from?: Date;
    to?: Date;
  };
  onActionChange?: (value: string | undefined) => void;
  onEntityTypeChange?: (value: string | undefined) => void;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
}

interface Props {
  logs: AuditLogWithUser[];
  totalCount?: number;
  viewerRole: string;
  filters?: AuditLogFilters;
}

const ACTION_ICONS: Record<string, any> = {
  CREATE: Plus,
  UPDATE: Edit3,
  DELETE: Trash2,
  VIEW: Eye,
  COMPLETE: Check,
  SUSPEND: ArrowLeftRight,
  RESUME: ArrowLeftRight,
  CANCEL: Trash2,
  TERMINATE: Trash2,
  CLONE_ROLE: Copy,
  LINK_USER_CUSTOMER: ArrowLeftRight,
  UNLINK_USER_CUSTOMER: ArrowLeftRight,
  TOGGLE_USER_ACTIVE: Check,
  BULK_UPDATE_ROLE: Edit3,
};

const ACTION_TONE: Record<string, string> = {
  CREATE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-blue-50 text-blue-700 border-blue-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
  SUSPEND: "bg-amber-50 text-amber-700 border-amber-200",
  CANCEL: "bg-red-50 text-red-700 border-red-200",
  TERMINATE: "bg-red-50 text-red-700 border-red-200",
  CLONE_ROLE: "bg-purple-50 text-purple-700 border-purple-200",
  LINK_USER_CUSTOMER: "bg-indigo-50 text-indigo-700 border-indigo-200",
  UNLINK_USER_CUSTOMER: "bg-orange-50 text-orange-700 border-orange-200",
  TOGGLE_USER_ACTIVE: "bg-cyan-50 text-cyan-700 border-cyan-200",
  BULK_UPDATE_ROLE: "bg-violet-50 text-violet-700 border-violet-200",
};

const ALL_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "VIEW",
  "COMPLETE",
  "SUSPEND",
  "RESUME",
  "CANCEL",
  "TERMINATE",
  "CLONE_ROLE",
  "LINK_USER_CUSTOMER",
  "UNLINK_USER_CUSTOMER",
  "TOGGLE_USER_ACTIVE",
  "BULK_UPDATE_ROLE",
];

const ALL_ENTITY_TYPES = [
  { value: "customer", label: "Klant" },
  { value: "tracker", label: "Tracker" },
  { value: "sim", label: "SIM" },
  { value: "vehicle", label: "Voertuig" },
  { value: "product", label: "Product" },
  { value: "subscription", label: "Abonnement" },
  { value: "activation_order", label: "Activatie" },
  { value: "user", label: "Gebruiker" },
  { value: "role", label: "Rol" },
  { value: "setting", label: "Instelling" },
  { value: "audit_log", label: "Auditlog" },
];

const ENTITY_LINKS: Record<string, (id: string) => string> = {
  customer: (id) => `/customers/${id}`,
  tracker: (id) => `/trackers/${id}`,
  sim: (id) => `/sims/${id}`,
  vehicle: (id) => `/vehicles/${id}`,
  product: (id) => `/products/${id}`,
  subscription: (id) => `/subscriptions/${id}`,
  activation_order: (id) => `/activations/${id}`,
  user: (id) => `/users/${id}`,
};

export function AuditLogList({ logs, totalCount, viewerRole, filters }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const columns: ColumnDef<AuditLogWithUser>[] = [
    {
      accessorKey: "timestamp",
      header: "Tijd",
      size: 180,
      cell: ({ row }) => {
        const t = row.original.timestamp;
        return (
          <span className="whitespace-nowrap text-xs text-slate-600">
            {formatDate(new Date(t))}
          </span>
        );
      },
    },
    {
      accessorKey: "action",
      header: "Actie",
      size: 120,
      cell: ({ row }) => {
        const action = row.getValue<string>("action");
        const Icon = ACTION_ICONS[action] ?? ArrowLeftRight;
        const tone = ACTION_TONE[action] ?? "bg-slate-50 text-slate-700 border-slate-200";
        return (
          <Badge variant="outline" className={`gap-1 ${tone}`}>
            <Icon className="h-3 w-3" />
            {action}
          </Badge>
        );
      },
    },
    {
      accessorKey: "entityType",
      header: "Type",
      size: 140,
      cell: ({ row }) => {
        const et = row.getValue<string>("entityType");
        const labels: Record<string, string> = {
          customer: "Klant",
          tracker: "Tracker",
          sim: "SIM",
          vehicle: "Voertuig",
          product: "Product",
          subscription: "Abonnement",
          activation_order: "Activatie",
          user: "Gebruiker",
          setting: "Instelling",
          audit_log: "Auditlog",
        };
        return <span className="font-medium">{labels[et] ?? et}</span>;
      },
    },
    {
      accessorKey: "entityId",
      header: "Object",
      cell: ({ row }) => {
        const et = row.original.entityType;
        const eid = row.original.entityId;
        const href = ENTITY_LINKS[et]?.(eid);
        const display = eid.length > 20 ? eid.substring(0, 17) + "…" : eid;
        if (href) {
          return (
            <Link
              href={href}
              className="font-mono text-xs underline-offset-4 hover:underline"
            >
              {display}
            </Link>
          );
        }
        return <span className="font-mono text-xs text-slate-600">{display}</span>;
      },
    },
    {
      id: "user",
      header: "Gebruiker",
      size: 180,
      cell: ({ row }) => {
        const u = row.original.user;
        if (!u) return <span className="text-slate-400">—</span>;
        return (
          <div className="text-sm">
            <div className="font-medium">{u.name ?? u.email}</div>
            {u.name ? (
              <div className="text-xs text-slate-500">{u.email}</div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "changes",
      header: "Wijzigingen",
      cell: ({ row }) => {
        const hasOld = !!row.original.oldValues;
        const hasNew = !!row.original.newValues;
        if (!hasOld && !hasNew) return <span className="text-slate-400">—</span>;
        const logId = row.original.id;
        const isOpen = expanded === logId;
        return (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(isOpen ? null : logId)}
          >
            {isOpen ? "Verbergen" : "Tonen"}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Auditlog</h1>
          <p className="text-sm text-slate-500">
            {viewerRole === "VIEWER"
              ? "Alleen je eigen acties zijn zichtbaar."
              : "Alle acties in het systeem zijn traceerbaar."}
            {totalCount != null ? ` (${totalCount} records)` : ""}
          </p>
        </div>
      </div>

      {filters ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
            <CardDescription>
              Filter de auditlog op actie, type of datumreeks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">Actie</label>
                <Select
                  value={filters.action ?? ""}
                  onValueChange={(v) =>
                    filters.onActionChange?.(v ? v : undefined)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Alle acties" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Alle acties</SelectItem>
                    {ALL_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">Type</label>
                <Select
                  value={filters.entityType ?? ""}
                  onValueChange={(v) =>
                    filters.onEntityTypeChange?.(v ? v : undefined)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Alle typen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Alle typen</SelectItem>
                    {ALL_ENTITY_TYPES.map((et) => (
                      <SelectItem key={et.value} value={et.value}>
                        {et.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">Van datum</label>
                <Input
                  type="date"
                  value={
                    filters.dateRange?.from
                      ? new Date(filters.dateRange.from).toISOString().slice(0, 10)
                      : ""
                  }
                  onChange={(e) => filters.onDateFromChange?.(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">Tot datum</label>
                <Input
                  type="date"
                  value={
                    filters.dateRange?.to
                      ? new Date(filters.dateRange.to).toISOString().slice(0, 10)
                      : ""
                  }
                  onChange={(e) => filters.onDateToChange?.(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Activiteitsgeschiedenis</CardTitle>
          <CardDescription>
            Klik op &quot;Tonen&quot; om gewijzigde velden te bekijken.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={logs}
            totalCount={totalCount}
            searchPlaceholder="Zoeken op type, object, gebruiker..."
          />
        </CardContent>
      </Card>

      {expanded
        ? (() => {
            const log = logs.find((l) => l.id === expanded);
            if (!log) return null;
            const hasOld = !!log.oldValues && Object.keys(log.oldValues as any).length > 0;
            const hasNew = !!log.newValues && Object.keys(log.newValues as any).length > 0;
            return (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    Wijziging details
                    <Badge variant="outline" className="font-mono text-xs">
                      {log.id}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {log.action} op {log.entityType} – {formatDate(new Date(log.timestamp))}
                    {log.user ? ` door ${log.user.name ?? log.user.email}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {hasOld || hasNew ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {hasOld ? (
                        <div className="rounded-lg border border-red-200 bg-red-50/60">
                          <div className="flex items-center justify-between border-b border-red-200 px-4 py-2">
                            <h3 className="text-sm font-semibold text-red-700">
                              Oude waarden
                            </h3>
                            <ChevronDown className="h-4 w-4 text-red-500" />
                          </div>
                          <div className="p-4">
                            <pre className="overflow-x-auto text-xs leading-relaxed text-red-900">
                              <code>{JSON.stringify(log.oldValues, null, 2)}</code>
                            </pre>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60">
                          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
                            <h3 className="text-sm font-semibold text-slate-500">
                              Oude waarden
                            </h3>
                          </div>
                          <div className="p-4">
                            <p className="text-xs text-slate-400 italic">
                              Geen oude waarden beschikbaar (nieuw object aangemaakt).
                            </p>
                          </div>
                        </div>
                      )}
                      {hasNew ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60">
                          <div className="flex items-center justify-between border-b border-emerald-200 px-4 py-2">
                            <h3 className="text-sm font-semibold text-emerald-700">
                              Nieuwe waarden
                            </h3>
                            <ChevronUp className="h-4 w-4 text-emerald-500" />
                          </div>
                          <div className="p-4">
                            <pre className="overflow-x-auto text-xs leading-relaxed text-emerald-900">
                              <code>{JSON.stringify(log.newValues, null, 2)}</code>
                            </pre>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60">
                          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
                            <h3 className="text-sm font-semibold text-slate-500">
                              Nieuwe waarden
                            </h3>
                          </div>
                          <div className="p-4">
                            <p className="text-xs text-slate-400 italic">
                              Geen nieuwe waarden beschikbaar (object verwijderd).
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">
                      Geen waarden vastgelegd voor deze actie.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })()
        : null}
    </div>
  );
}
