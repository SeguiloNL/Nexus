"use client";

import Link from "next/link";
import type { ColumnDef, Row } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Edit, Power, PowerOff } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import { BulkActionForm } from "@/components/data-table/bulk-action-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Product } from "@prisma/client";
import { formatCurrency } from "@/lib/formatters";
import {
  bulkActivateProductsAction,
  bulkDeactivateProductsAction,
  type BulkActionState,
} from "../actions";

type ListProduct = Product;

interface ProductListProps {
  products: ListProduct[];
  canCreate: boolean;
  canEdit: boolean;
}

export function ProductList({ products, canCreate, canEdit }: ProductListProps) {
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
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
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
        enableRowSelection={canEdit}
        getRowId={(row) => (row as any).id}
        bulkActions={
          canEdit
            ? ({ selectedRows, clearSelection }) => {
                const ids = selectedRows.map((r: Row<ListProduct>) => r.original.id);
                return (
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
                      <Button variant="outline" size="sm" type="button">
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
                      <Button variant="outline" size="sm" type="button">
                        <PowerOff className="mr-2 h-4 w-4" /> Deactiveren
                      </Button>
                    </BulkActionForm>
                  </>
                );
              }
            : undefined
        }
      />
    </div>
  );
}
