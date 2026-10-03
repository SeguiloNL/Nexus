"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronDown, Users, User, Receipt, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerStatusBadge } from "@/components/ui/status-badges";
import type { CustomerHierarchyNode } from "@/types/domain";
import type { CustomerType } from "@/types/enums";

const TYPE_LABEL: Record<CustomerType, string> = {
  DIRECT: "Klant",
  RESELLER: "Reseller",
  PARTNER: "Partner",
};

const TYPE_TONE: Record<CustomerType, string> = {
  DIRECT: "bg-blue-50 text-blue-700 border-blue-200",
  RESELLER: "bg-amber-50 text-amber-700 border-amber-200",
  PARTNER: "bg-teal-50 text-teal-700 border-teal-200",
};

function collectAllIds(nodes: CustomerHierarchyNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: CustomerHierarchyNode[]) => {
    for (const n of list) {
      ids.push(n.id);
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

export function CustomerHierarchyTree({
  nodes,
  showExpandAll = true,
}: {
  nodes: CustomerHierarchyNode[];
  showExpandAll?: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const id of collectAllIds(nodes)) init[id] = true;
    return init;
  });
  const [allExpanded, setAllExpanded] = useState(true);

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    for (const id of collectAllIds(nodes)) all[id] = true;
    setExpanded(all);
    setAllExpanded(true);
  };

  const collapseAll = () => {
    setExpanded({});
    setAllExpanded(false);
  };

  const setDescendantsExpanded = (
    rootNode: CustomerHierarchyNode,
    shouldExpand: boolean
  ) => {
    const updates: Record<string, boolean> = {};
    const walk = (list: CustomerHierarchyNode[]) => {
      for (const n of list) {
        updates[n.id] = shouldExpand;
        if (n.children.length) walk(n.children);
      }
    };
    updates[rootNode.id] = shouldExpand;
    if (rootNode.children.length) walk(rootNode.children);
    setExpanded((prev) => ({ ...prev, ...updates }));
  };

  return (
    <div className="space-y-3">
      {showExpandAll ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={allExpanded ? collapseAll : expandAll}
          >
            {allExpanded ? (
              <>
                <ChevronRight className="mr-1.5 h-4 w-4" /> Alles inklappen
              </>
            ) : (
              <>
                <ChevronDown className="mr-1.5 h-4 w-4" /> Alles uitklappen
              </>
            )}
          </Button>
        </div>
      ) : null}
      <div className="space-y-1">
        {nodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            expanded={expanded}
            onToggle={toggle}
            onExpandDescendants={setDescendantsExpanded}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  expanded,
  onToggle,
  onExpandDescendants,
}: {
  node: CustomerHierarchyNode;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onExpandDescendants: (node: CustomerHierarchyNode, expand: boolean) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded[node.id] ?? false;
  const paddingLeft = `${node.level * 1.25 + 0.5}rem`;

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2 min-h-[48px] hover:bg-slate-50 active:bg-slate-100 md:min-h-0 md:px-3 md:py-2"
        style={{ paddingLeft }}
      >
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={isExpanded ? "Inklappen" : "Uitklappen"}
            onClick={() => onToggle(node.id)}
            title={isExpanded ? "Inklappen" : "Uitklappen"}
          >
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 md:h-4 md:w-4" />
            ) : (
              <ChevronRight className="h-5 w-5 md:h-4 md:w-4" />
            )}
          </Button>
        ) : (
          <span className="inline-block h-11 w-11 shrink-0 md:h-7 md:w-7" />
        )}
        <Link
          href={`/customers/${node.id}`}
          className="min-w-0 flex-1 items-center gap-2 overflow-hidden"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">
                  {node.companyName}
                </span>
                <CustomerStatusBadge status={node.status} />
                <Badge variant="outline" className={TYPE_TONE[node.type]}>
                  {TYPE_LABEL[node.type]}
                </Badge>
              </div>
              <div className="text-xs text-slate-500">
                {node.customerNumber}
              </div>
            </div>
          </div>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge
            variant="outline"
            className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700"
            title="Directe gebruikers (alleen deze klant)"
          >
            <User className="h-3 w-3" />
            {node.directUserCount}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 border-purple-200 bg-purple-50 text-purple-700"
            title="Effectieve gebruikers (inclusief subklanten)"
          >
            <Users className="h-3 w-3" />
            {node.effectiveUserCount}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700"
            title="Abonnementen"
          >
            <Receipt className="h-3 w-3" />
            {node.directSubscriptionCount}
          </Badge>
        </div>
      </div>
      {hasChildren && isExpanded ? (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              onExpandDescendants={onExpandDescendants}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CustomerHierarchyTreeCard({
  title,
  description,
  nodes,
}: {
  title?: string;
  description?: string;
  nodes: CustomerHierarchyNode[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" />
          {title ?? "Klant hiërarchie"}
        </CardTitle>
        {description ? (
          <div className="text-sm text-slate-500">{description}</div>
        ) : null}
      </CardHeader>
      <CardContent>
        {nodes.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            Geen klanten gevonden binnen je toegang.
          </div>
        ) : (
          <CustomerHierarchyTree nodes={nodes} />
        )}
      </CardContent>
    </Card>
  );
}
