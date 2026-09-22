"use client";

import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = RadixDropdown.Root;
export const DropdownMenuTrigger = RadixDropdown.Trigger;

export function DropdownMenuContent({
  className,
  align = "end",
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdown.Content>) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        align={align}
        sideOffset={4}
        className={cn(
          "z-50 min-w-[180px] rounded-md border border-[var(--color-border)] bg-white p-1 shadow-lg",
          className,
        )}
        {...props}
      />
    </RadixDropdown.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixDropdown.Item>) {
  return (
    <RadixDropdown.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof RadixDropdown.Separator>) => (
  <RadixDropdown.Separator className={cn("my-1 h-px bg-[var(--color-border)]", className)} {...props} />
);

export const DropdownMenuLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof RadixDropdown.Label>) => (
  <RadixDropdown.Label className={cn("px-2 py-1.5 text-xs font-semibold text-slate-400", className)} {...props} />
);
