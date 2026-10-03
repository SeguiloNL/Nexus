"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Edit, Power, PowerOff, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { BulkActionForm } from "@/components/data-table/bulk-action-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Product } from "@prisma/client";
import { formatCurrency } from "@/lib/formatters";
import { toast } from "sonner";
import {
  bulkActivateProductsAction,
  bulkDeactivateProductsAction,
  bulkDeleteProductsAction,
  deleteProductAction,
  type BulkActionState,
} from "../actions";

type ListProduct = Product;

interface ProductListProps {
  products: ListProduct[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function DeleteRowDialog({
  product,
  canDelete,
}: {
  product: ListProduct;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <DropdownMenuItem
        disabled={!canDelete}
        className="text-red-600 focus:bg-red-50 focus:text-red-700"
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
      </DropdownMenuItem>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Product verwijderen</DialogTitle>
            <DialogDescription>
              Weet je zeker dat je het product{" "}
              <strong>{product.name}</strong> ({product.productCode}) wilt
              verwijderen? Dit kan niet ongedaan worden gemaakt. Producten met
              actieve abonnementen of activeringsorders kunnen niet verwijderd
              worden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Annuleren
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteProductAction(product.id);
                  if (result.ok) {
                    toast.success(result.message ?? "Product verwijderd.");
                    setOpen(false);
                  } else {
                    toast.error(result.error ?? "Verwijderen mislukt.");
                  }
                });
              }}
            >
              {isPending ? "Bezig…" : "Definitief verwijderen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProductList({ products, canCreate, canEdit, canDelete }: ProductListProps) {
  const columns: ColumnDef<ListProduct>[] = [
    {
      accessorKey: "productCode",
      header: "Code",
      cell: ({ row }) => (
        <Link
          className="font-mono text-xs font-medium underline-offset-4 hover:underline"
          href={`/products/${row.original.id}`}
        >
          {row.getValue("productCode")}
        </Link>
      ),
    },
    {
      accessorKey: "name",
      header: "Naam",
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          href={`/products/${row.original.id}`}
        >
          {row.getValue("name")}
        </Link>
      ),
    },
    {
      accessorKey: "monthlyPrice",
      header: "Prijs / mnd",
      cell: ({ row }) => (
        <span className="font-mono">
          {formatCurrency(Number(row.getValue("monthlyPrice")))}
        </span>
      ),
    },
    {
      accessorKey: "currency",
      header: "Valuta",
      cell: ({ row }) => (
        <span className="uppercase">{row.getValue("currency")}</span>
      ),
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) =>
        row.getValue("isActive") ? (
          <Badge variant="success">Actief</Badge>
        ) : (
          <Badge variant="muted">Inactief</Badge>
        ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const id = row.original.id;
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Open menu">
                  <MoreHorizontal className="h-5 w-5 md:h-4 md:w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Acties</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href={`/products/${id}`}>Details bekijken</Link>
                </DropdownMenuItem>
                {canEdit ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/products/${id}?tab=edit`}>
                      <Edit className="mr-2 h-4 w-4" /> Bewerken
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DeleteRowDialog product={row.original} canDelete={canDelete} />
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Producten</h1>
          <p className="text-sm text-slate-500">
            Abonnementsvormen en maandprijzen (ADMIN-only).
          </p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link href="/products/new">
              <Plus className="h-4 w-4" /> Nieuw product
            </Link>
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={products}
        searchColumnAccessor="name"
        searchPlaceholder="Zoek product (naam, code, omschrijving…)"
        enableRowSelection={canEdit || canDelete}
        getRowId={(row) => (row as any).id}
        bulkActions={
          canEdit || canDelete
            ? ({ selectedRows, clearSelection }) => {
                const ids = selectedRows.map((r: Row<ListProduct>) => r.original.id);
                return (
                  <>
                    {canEdit ? (
                      <>
                        <BulkActionForm
                          action={
                            bulkActivateProductsAction as (
                              prev: BulkActionState,
                              form: FormData
                            ) => Promise<BulkActionState>
                          }
                          ids={ids}
                          clearSelection={clearSelection}
                        >
                          <Button variant="outline" size="sm" type="submit">
                            <Power className="mr-2 h-4 w-4" /> Activeren
                          </Button>
                        </BulkActionForm>
                        <BulkActionForm
                          action={
                            bulkDeactivateProductsAction as (
                              prev: BulkActionState,
                              form: FormData
                            ) => Promise<BulkActionState>
                          }
                          ids={ids}
                          clearSelection={clearSelection}
                        >
                          <Button variant="outline" size="sm" type="submit">
                            <PowerOff className="mr-2 h-4 w-4" /> Deactiveren
                          </Button>
                        </BulkActionForm>
                      </>
                    ) : null}
                    {canDelete ? (
                      <BulkActionForm
                        action={
                          bulkDeleteProductsAction as (
                            prev: BulkActionState,
                            form: FormData
                          ) => Promise<BulkActionState>
                        }
                        ids={ids}
                        clearSelection={clearSelection}
                        confirmTitle="Geselecteerde producten verwijderen"
                        confirmDescription={`Weet je zeker dat je ${ids.length} geselecteerd(e) product(en) definitief wilt verwijderen? Producten met abonnementen of activeringsorders worden overgeslagen.`}
                        confirmConfirmLabel="Verwijderen"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Verwijderen
                        </Button>
                      </BulkActionForm>
                    ) : null}
                  </>
                );
              }
            : undefined
        }
      />
    </div>
  );
}
