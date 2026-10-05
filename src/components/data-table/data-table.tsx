"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type Row,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type { ColumnDef } from "@tanstack/react-table";

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchColumnAccessor?: string;
  searchColumnAccessors?: string[];
  searchPlaceholder?: string;
  pageSizeOptions?: number[];
  totalCount?: number;
  className?: string;
  enableRowSelection?: boolean;
  getRowId?: (row: TData, index: number, parent?: Row<TData>) => string;
  defaultSorting?: SortingState;
  bulkActions?: (params: {
    selectedRows: Row<TData>[];
    selectedCount: number;
    clearSelection: () => void;
  }) => React.ReactNode;
}

/**
 * Client-side DataTable met URL-sync compatibiliteit:
 * - search, sort, page, perPage kunnen later via searchParams hydrateren
 * - Eenvoudige paginering, kolom zichtbaarheid, global search
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  searchColumnAccessor,
  searchColumnAccessors,
  searchPlaceholder = "Zoeken…",
  pageSizeOptions = [10, 20, 50],
  totalCount,
  className,
  enableRowSelection = false,
  getRowId,
  defaultSorting = [],
  bulkActions,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(defaultSorting);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [{ pageIndex, pageSize }, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: pageSizeOptions[0] ?? 10,
  });
  const [globalFilter, setGlobalFilter] = React.useState("");

  const pagination = React.useMemo(
    () => ({ pageIndex, pageSize }),
    [pageIndex, pageSize]
  );

  const selectCol: ColumnDef<TData, TValue> = React.useMemo(
    () => ({
      id: "__select__",
      header: ({ table }) => {
        if (!enableRowSelection) return null;
        const checked = table.getIsAllPageRowsSelected();
        const some = table.getIsSomePageRowsSelected();
        return (
          <div className="flex items-center justify-center">
            <label className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-slate-100 active:bg-slate-100 md:h-9 md:w-9">
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 md:h-4 md:w-4"
                aria-label="Selecteer alle rijen op deze pagina"
                checked={checked}
                ref={(el) => {
                  if (el) el.indeterminate = !checked && some;
                }}
                onChange={(e) =>
                  table.toggleAllPageRowsSelected(!!e.target.checked)
                }
              />
            </label>
          </div>
        );
      },
      cell: ({ row }) => {
        if (!enableRowSelection) return null;
        return (
          <div className="flex items-center justify-center">
            <label className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-slate-100 active:bg-slate-100 md:h-9 md:w-9">
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 md:h-4 md:w-4"
                aria-label="Selecteer rij"
                checked={row.getIsSelected()}
                disabled={!row.getCanSelect()}
                onChange={(e) => row.toggleSelected(!!e.target.checked)}
                onClick={(e) => e.stopPropagation()}
              />
            </label>
          </div>
        );
      },
      enableSorting: false,
      enableHiding: false,
      size: 48,
    }),
    [enableRowSelection]
  );

  const finalColumns = React.useMemo(
    () => (enableRowSelection ? [selectCol, ...columns] : columns),
    [enableRowSelection, selectCol, columns]
  );

  const table = useReactTable({
    data,
    columns: finalColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(enableRowSelection ? { enableRowSelection: true as const, getRowId } : {}),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _columnId, filterValue) => {
      const fv = String(filterValue).toLowerCase();
      if (!searchColumnAccessor && !searchColumnAccessors) return true;
      if (searchColumnAccessors && searchColumnAccessors.length > 0) {
        return searchColumnAccessors.some((acc) => {
          const v = row.getValue(acc);
          if (v == null) return false;
          return String(v).toLowerCase().includes(fv);
        });
      }
      if (!searchColumnAccessor) return true;
      const v = row.getValue(searchColumnAccessor);
      if (v == null) return false;
      return String(v).toLowerCase().includes(fv);
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
      pagination,
    },
  });

  const pageCount = table.getPageCount();
  const displayedTotal = totalCount ?? table.getFilteredRowModel().rows.length;
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCount = selectedRows.length;

  const clearSelection = React.useCallback(() => {
    setRowSelection({});
  }, []);

  const showBulk = enableRowSelection && selectedCount > 0 && bulkActions;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
        <div className="w-full md:w-72">
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter ?? ""}
            onChange={(event) => setGlobalFilter(String(event.target.value))}
            className="h-9"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Kolommen <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showBulk ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2">
          <div className="text-sm font-medium text-blue-800">
            {selectedCount} rij{selectedCount === 1 ? "" : "en"} geselecteerd
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions({ selectedRows, selectedCount, clearSelection })}
          </div>
        </div>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const defEnabled = (header.column.columnDef.enableSorting as unknown) === true;
                  const canSort = header.column.getCanSort() || defEnabled;
                  const sorted = header.column.getIsSorted();
                  const ariaSort =
                    sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                      ? "descending"
                      : undefined;
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={ariaSort}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex w-full items-center gap-1.5 text-left font-medium text-slate-700 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded-sm"
                          title={
                            sorted === "asc"
                              ? "Klik om aflopend te sorteren"
                              : sorted === "desc"
                              ? "Klik om sortering te verwijderen"
                              : "Klik om oplopend te sorteren"
                          }
                          aria-label={(() => {
                            const label = typeof header.column.columnDef.header === "string" ? `${header.column.columnDef.header}. ` : "";
                            if (sorted === "asc") return `${label}Sorteert oplopend. Klik om aflopend te sorteren.`;
                            if (sorted === "desc") return `${label}Sorteert aflopend. Klik om sortering te verwijderen.`;
                            return `${label}Klik om oplopend te sorteren.`;
                          })()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          <span className="flex shrink-0 items-center" aria-hidden="true">
                            {sorted === "asc" ? (
                              <ChevronUp className="h-3.5 w-3.5 text-slate-600" />
                            ) : sorted === "desc" ? (
                              <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
                            ) : (
                              <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
                            )}
                          </span>
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={finalColumns.length}
                  className="h-24 text-center text-slate-500"
                >
                  Geen resultaten.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="text-center text-sm text-slate-500 sm:text-left">
          {displayedTotal > 0 ? (
            <>
              {pageIndex * pageSize + 1}–
              {Math.min((pageIndex + 1) * pageSize, displayedTotal)} van{" "}
              {displayedTotal}
            </>
          ) : (
            <>0 resultaten</>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center justify-between gap-2 text-sm text-slate-500 sm:justify-start">
            Per pagina
            <select
              className="h-11 min-w-[96px] rounded-md border border-slate-200 bg-white px-3 py-2 text-base md:h-10 md:text-sm"
              value={pageSize}
              onChange={(e) => {
                setPagination({
                  pageIndex: 0,
                  pageSize: Number(e.target.value),
                });
              }}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between gap-2 sm:justify-start sm:gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Vorige pagina"
            >
              <ChevronLeft className="h-5 w-5 md:h-4 md:w-4" />
            </Button>
            <div className="flex-1 px-2 text-center text-sm text-slate-600 sm:flex-none sm:min-w-[90px]">
              Pagina {pageIndex + 1}
              {pageCount > 0 ? ` / ${pageCount}` : ""}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Volgende pagina"
            >
              <ChevronRight className="h-5 w-5 md:h-4 md:w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
