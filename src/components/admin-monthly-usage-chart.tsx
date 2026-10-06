"use client";

import { BarChart3, TrendingUp, Database } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/formatters";

export type AdminTopSimUsage = {
  name: string;
  usedBytes: number;
};

export type AdminMonthlyUsageChartProps = {
  totalUsedBytes: bigint;
  totalLimitBytes: bigint | null;
  activeSimCount: number;
  topSims: AdminTopSimUsage[];
  monthLabel: string;
};

function safeBigIntToNumber(v: bigint | null | undefined): number {
  if (v === null || v === undefined) return 0;
  try {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

const BAR_COLORS = [
  "#0ea5e9",
  "#06b6d4",
  "#14b8a6",
  "#10b981",
  "#22c55e",
  "#84cc16",
  "#eab308",
  "#f59e0b",
  "#f97316",
  "#ef4444",
];

export default function AdminMonthlyUsageChart({
  totalUsedBytes,
  totalLimitBytes,
  activeSimCount,
  topSims,
  monthLabel,
}: AdminMonthlyUsageChartProps) {
  const totalUsedNum = safeBigIntToNumber(totalUsedBytes);
  const totalLimitNum = totalLimitBytes ? safeBigIntToNumber(totalLimitBytes) : 0;

  const usagePercent =
    totalLimitNum > 0
      ? Math.min(100, Math.round((totalUsedNum / totalLimitNum) * 100))
      : null;

  const chartData = topSims.map((s, i) => ({
    name: s.name.length > 14 ? s.name.slice(0, 11) + "..." : s.name,
    fullName: s.name,
    used: s.usedBytes,
    usedFormatted: formatBytes(s.usedBytes, 1),
    color: BAR_COLORS[i % BAR_COLORS.length],
  }));

  const hasData = chartData.length > 0;

  return (
    <Card className="border-sky-100 bg-gradient-to-br from-white via-sky-50/40 to-white shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-slate-800">
              Totaal dataverbruik SIMs
            </CardTitle>
            <p className="text-xs text-slate-500">
              Alle actieve SIMs • {monthLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
          <Database className="h-3 w-3" />
          {activeSimCount} actieve SIMs
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div className="flex flex-col justify-center rounded-xl border border-sky-100 bg-white/80 p-5">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Totaal verbruikt deze maand
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-slate-900">
                  {formatBytes(totalUsedBytes, 2)}
                </span>
                {usagePercent !== null && (
                  <span className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                    <TrendingUp className="h-3 w-3" />
                    {usagePercent}%
                  </span>
                )}
              </div>
            </div>

            {totalLimitNum > 0 ? (
              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Van het gebundelde limiet</span>
                  <span className="font-medium text-slate-700 tabular-nums">
                    {formatBytes(totalUsedBytes, 1)} / {formatBytes(totalLimitBytes, 1)}
                  </span>
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-valuenow={usagePercent ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Totaal verbruik als percentage van limiet"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      usagePercent !== null && usagePercent >= 95
                        ? "bg-red-500"
                        : usagePercent !== null && usagePercent >= 80
                          ? "bg-amber-500"
                          : "bg-sky-500"
                    }`}
                    style={{ width: `${Math.min(100, usagePercent ?? 0)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                Geen gebundeld limiet bekend voor de actieve SIMs in deze periode.
              </div>
            )}

            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs">
              <div>
                <dt className="text-slate-500">Topverbruiker</dt>
                <dd className="mt-1 font-semibold text-slate-800 tabular-nums">
                  {hasData ? formatBytes(BigInt(chartData[0].used), 1) : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Gemiddelde / SIM</dt>
                <dd className="mt-1 font-semibold text-slate-800 tabular-nums">
                  {activeSimCount > 0
                    ? formatBytes(BigInt(Math.round(totalUsedNum / activeSimCount)), 1)
                    : "-"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="min-h-[240px] rounded-xl border border-slate-100 bg-white/80 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-600">
                Top {chartData.length} meest verbruikende SIMs
              </p>
            </div>
            {hasData ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={60}
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
                    formatter={(value: unknown) => formatBytes(value as number, 2)}
                    labelFormatter={(label: unknown, items: readonly unknown[]) => {
                      const it = items as readonly { payload: { fullName: string } }[] | undefined;
                      return it?.[0]?.payload?.fullName ?? String(label ?? "");
                    }}
                  />
                  <Bar
                    dataKey="used"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={36}
                    aria-label="Dataverbruik per SIM"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[240px] flex-col items-center justify-center text-center text-sm text-slate-400">
                <Database className="mb-2 h-10 w-10 text-slate-200" />
                <p className="font-medium text-slate-500">Nog geen verbruiksdata</p>
                <p className="mt-1 text-xs text-slate-400">
                  Voer eerst een usage-sync uit om de data te verzamelen.
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
