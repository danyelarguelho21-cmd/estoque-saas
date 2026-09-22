"use client";

import * as RadixLabel from "@radix-ui/react-label";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<
  React.ElementRef<typeof RadixLabel.Root>,
  ComponentPropsWithoutRef<typeof RadixLabel.Root> & { required?: boolean }
>(({ className, required = false, children, ...props }, ref) => (
  <RadixLabel.Root
    ref={ref}
    className={cn("mb-1.5 block text-sm font-medium text-slate-700", className)}
    {...props}
  >
    {children}
    {required && (
      <span className="ml-0.5 text-[var(--color-danger)]" aria-hidden>
        *
      </span>
    )}
  </RadixLabel.Root>
));
Label.displayName = "Label";
