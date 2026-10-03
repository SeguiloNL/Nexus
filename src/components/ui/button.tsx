import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 text-base [&_svg]:size-5 md:text-sm md:[&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-slate-900 text-slate-50 hover:bg-slate-900/90 active:bg-slate-900",
        destructive:
          "bg-red-500 text-slate-50 hover:bg-red-500/90 active:bg-red-500",
        outline:
          "border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900 active:bg-slate-100",
        secondary:
          "bg-slate-100 text-slate-900 hover:bg-slate-100/80 active:bg-slate-200",
        ghost: "hover:bg-slate-100 hover:text-slate-900 active:bg-slate-100",
        link: "text-slate-900 underline-offset-4 hover:underline",
        success:
          "bg-emerald-600 text-white hover:bg-emerald-600/90 active:bg-emerald-700",
      },
      size: {
        default: "h-12 px-4 py-2.5 md:h-12",
        sm: "h-11 rounded-md px-3 md:h-10 md:px-3",
        lg: "h-14 rounded-md px-8",
        compact: "h-9 rounded-md px-3",
        icon: "h-12 w-12 md:h-11 md:w-11",
        "icon-sm": "h-11 w-11 md:h-9 md:w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
