"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
};

const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => {
    const ariaOrientation = decorative
      ? undefined
      : orientation === "horizontal"
        ? "horizontal"
        : "vertical";
    return (
      <div
        ref={ref}
        role={decorative ? "none" : "separator"}
        aria-orientation={ariaOrientation}
        className={cn(
          "shrink-0 bg-slate-200",
          orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
          className
        )}
        {...props}
      />
    );
  }
);
Separator.displayName = "Separator";

export { Separator };
