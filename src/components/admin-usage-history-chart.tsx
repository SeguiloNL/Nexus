"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { CalendarDays, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/formatters";

export type UsageHistoryPoint = {
  monthKey: string; // 'YYYY-MM'
  label: string; // 'oktober 2026'
  totalUsedBytes: number | null;
  simCount: number;
};

export type AdminUsageHistoryChartProps = {
  months: UsageHistoryPoint[];
  selectedMonthKey: string | null;
};

const SELECTED_COLOR = "#0284c7";
const DEFAULT_COLOR = "#7dd3fc";

function shortMonthLabel(monthKey: string, label: string): string {
  const month = label.slice(0, 3);
  const year = monthKey.slice(2, 4);
  return `${month} '${year}`;
}

export default function AdminUsageHistoryChart({
  months,
  selectedMonthKey,
}: AdminUsageHistoryChartProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const chartData = months.map((m) => ({
    monthKey: m.monthKey,
    short: shortMonthLabel(m.monthKey, m.label),
    full: m.label,
    used: m.totalUsedBytes,
    simCount: m.simCount,
  }));

  const hasAnyData = months.some((m) => m.totalUsedBytes !== null);

  function selectMonth(monthKey: string) {
    if (!monthKey || monthKey === selectedMonthKey) return;
    startTransition(() => {
      router.push(`/dashboard?maand=${monthKey}`);
    });
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-slate-800">
              Dataverbruik laatste 12 maanden
            </CardTitle>
            <p className="text-xs text-slate-500">
              Totaalverbruik van alle SIMs per maand
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="usage-history-month"
            className="flex items-center gap-1 text-xs font-medium text-slate-600"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Maand
          </label>
          <select
            id="usage-history-month"
            value={selectedMonthKey ?? ""}
            disabled={isPending}
            onChange={(e) => selectMonth(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
          >
            {[...months].reverse().map((m) => (
              <option key={m.monthKey} value={m.monthKey}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        {hasAnyData ? (
          <div
            role="img"
            aria-label="Staafdiagram met het totale dataverbruik per maand over de afgelopen 12 maanden"
            className="h-[220px] w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#f1f5f9"
                  vertical={false}
                />
                <XAxis
                  dataKey="short"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: unknown) => formatBytes(v as number, 0)}
                  width={56}
                />
                <Tooltip
                  cursor={{ fill: "#f8fafc" }}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 6px -1px rgb(15 23 42 / 0.08)",
                    fontSize: 12,
                  }}
                  formatter={(value: unknown) =>
                    value === null || value === undefined
                      ? "geen data"
                      : formatBytes(value as number, 2)
                  }
                  labelFormatter={(label: unknown, items: readonly unknown[]) => {
                    const it = items as
                      | readonly {
                          payload: { full: string; simCount: number };
                        }[]
                      | undefined;
                    const p = it?.[0]?.payload;
                    if (!p) return String(label ?? "");
                    return `${p.full} • ${p.simCount} SIMs gemeten`;
                  }}
                />
                <Bar dataKey="used" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.monthKey}
                      fill={
                        entry.monthKey === selectedMonthKey
                          ? SELECTED_COLOR
                          : DEFAULT_COLOR
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-[220px] flex-col items-center justify-center text-center text-sm text-slate-400">
            <TrendingUp className="mb-2 h-8 w-8 text-slate-200" />
            <p className="font-medium text-slate-500">
              Nog geen maandhistorie beschikbaar
            </p>
            <p className="mt-1 text-xs text-slate-400">
              De historie wordt opgebouwd zodra de usage-sync draait.
            </p>
          </div>
        )}

        {hasAnyData && (
          <p className="mt-2 text-xs text-slate-400">
            Maanden zonder data worden niet als 0 getoond. Kies een maand voor de
            detailweergave hieronder.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
