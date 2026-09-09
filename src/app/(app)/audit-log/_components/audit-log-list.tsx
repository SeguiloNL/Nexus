"use client";

import Link from "next/link";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
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
import { ArrowLeftRight, Plus, Edit3, Trash2, Eye, Check } from "lucide-react";
import type { AuditLog } from "@prisma/client";
import { formatDate } from "@/lib/formatters";

type AuditLogWithUser = AuditLog & {
  user?: { name: string | null; email: string };
};

interface Props {
  logs: AuditLogWithUser[];
  totalCount?: number;
  viewerRole: string;
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
};

const ACTION_TONE: Record<string, string> = {
  CREATE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-blue-50 text-blue-700 border-blue-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
  SUSPEND: "bg-amber-50 text-amber-700 border-amber-200",
  CANCEL: "bg-red-50 text-red-700 border-red-200",
  TERMINATE: "bg-red-50 text-red-700 border-red-200",
};

const ENTITY_LINKS: Record<string, (id: string) => string> = {
  customer: (id) => `/customers/${id}`,
  tracker: (id) => `/trackers/${id}`,
  sim: (id) => `/sims/${id}`,
  vehicle: (id) => `/vehicles/${id}`,
  product: (id) => `/products/${id}`,
  subscription: (id) => `/subscriptions/${id}`,
  activation_order: (id) => `/activations/${id}`,
  user: (_id) => `/users`,
};

export function AuditLogList({ logs, totalCount, viewerRole }: Props) {
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
            return (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Wijziging details</CardTitle>
                  <CardDescription>
                    {log.action} op {log.entityType} – {formatDate(new Date(log.timestamp))}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {log.oldValues ? (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-red-700">
                        Oude waarden
                      </h3>
                      <pre className="overflow-x-auto rounded-md border border-red-100 bg-red-50 p-3 text-xs text-red-900">
                        {JSON.stringify(log.oldValues, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                  {log.newValues ? (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-emerald-700">
                        Nieuwe waarden
                      </h3>
                      <pre className="overflow-x-auto rounded-md border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900">
                        {JSON.stringify(log.newValues, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })()
        : null}
    </div>
  );
}
