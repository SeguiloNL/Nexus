"use client";

import { useFormState } from "react-dom";
import { useEffect } from "react";
import { Upload, FileText, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  commitCustomerCsvAction,
  previewCustomerCsvAction,
  type CustomerCsvImportActionState,
} from "../../actions";

export function CustomerImportClient() {
  const router = useRouter();
  const [state, formAction] = useFormState<CustomerCsvImportActionState>(
    previewCustomerCsvAction as any,
    {}
  );

  const [commitState, commitAction] = useFormState<CustomerCsvImportActionState>(
    commitCustomerCsvAction as any,
    state
  );

  useEffect(() => {
    if (commitState.committed) {
      toast.success(
        `${commitState.committed.count} klanten succesvol geïmporteerd.`
      );
      setTimeout(() => router.push("/customers"), 1200);
    }
  }, [commitState.committed, router]);

  const preview = commitState.preview ?? state.preview;
  const committed = commitState.committed;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Klanten importeren (CSV)
          </CardTitle>
          <CardDescription>
            Upload een CSV-bestand met kolommen: <code className="bg-slate-100 px-1 rounded">companyName</code> (verplicht), en optioneel: customerNumber, parentCustomerId, address, postalCode, city, country, contactPerson, phone, email, kvkNr, btwNr, inserveCompanyId, status, notes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!preview ? (
            <form action={formAction} className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="file">CSV bestand</Label>
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept=".csv,text/csv"
                  required
                />
              </div>
              {state.message ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {state.message}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="submit">
                  <FileText className="mr-2 h-4 w-4" /> Voorbeeld bekijken
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  title="Totaal"
                  value={preview.total}
                  icon={<FileText className="h-4 w-4" />}
                  tone="neutral"
                />
                <StatCard
                  title="Geldig"
                  value={preview.valid.length}
                  icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                  tone="success"
                />
                <StatCard
                  title="Fouten"
                  value={preview.invalid.length}
                  icon={<XCircle className="h-4 w-4 text-red-600" />}
                  tone="error"
                />
              </div>

              {preview.invalid.length ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-red-700">
                    <XCircle className="h-4 w-4" /> Ongeldige rijen
                  </h3>
                  <div className="rounded-md border border-red-200 overflow-hidden">
                    <div className="max-h-48 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-red-50 text-left text-red-700">
                          <tr>
                            <th className="px-3 py-2">Rij</th>
                            <th className="px-3 py-2">Kolom fouten</th>
                            <th className="px-3 py-2">Waarde</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.invalid.map((r: any) => (
                            <tr key={r.row} className="border-t">
                              <td className="px-3 py-2 font-mono">{r.row}</td>
                              <td className="px-3 py-2">
                                <ul className="list-disc list-inside space-y-0.5 text-red-700">
                                  {Object.entries(r.errors as Record<string, string[]>).map(([k, vs]) => (
                                    <li key={k}>
                                      <span className="font-semibold">{k}:</span>{" "}
                                      {vs.join(", ")}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                              <td className="px-3 py-2 text-slate-600 font-mono text-[11px] truncate max-w-[200px]">
                                {JSON.stringify(r.raw).slice(0, 60)}…
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}

              {preview.valid.length ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Te importeren rijen (top 20 van {preview.valid.length})
                  </h3>
                  <div className="rounded-md border overflow-hidden">
                    <div className="max-h-56 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Rij</th>
                            <th className="px-3 py-2">Bedrijfsnaam</th>
                            <th className="px-3 py-2">Contact</th>
                            <th className="px-3 py-2">Plaats</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.valid.slice(0, 20).map((r: any) => (
                            <tr key={r.row} className="border-t">
                              <td className="px-3 py-2 font-mono">{r.row}</td>
                              <td className="px-3 py-2 font-medium">{r.data.companyName}</td>
                              <td className="px-3 py-2">{r.data.contactPerson || <span className="text-slate-400">—</span>}</td>
                              <td className="px-3 py-2">{r.data.city || <span className="text-slate-400">—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}

              {committed ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Import voltooid:{" "}
                  <strong>{committed.count}</strong> klanten toegevoegd. Je wordt zo terug gestuurd...
                </div>
              ) : null}

              <form action={commitAction} className="pt-2">
                <div className="flex gap-2 justify-between">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => location.reload()}
                      disabled={Boolean(committed)}
                    >
                      Ander bestand
                    </Button>
                  </div>
                  <Button
                    type="submit"
                    disabled={!preview.valid.length || Boolean(committed)}
                  >
                    {committed ? (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Gereed
                      </>
                    ) : (
                      <>
                        <ArrowRight className="mr-2 h-4 w-4" />{" "}
                        {preview.valid.length} klanten importeren
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  tone: "neutral" | "success" | "error";
}) {
  const toneCls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "error"
        ? "border-red-200 bg-red-50"
        : "border-slate-200 bg-slate-50";
  return (
    <div className={`rounded-md border px-3 py-3 ${toneCls}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600">{title}</span>
        {icon}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
