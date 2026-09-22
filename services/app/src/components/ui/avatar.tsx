"use client";

import * as RadixAvatar from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <RadixAvatar.Root
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-primary)] text-sm font-medium text-white",
        className,
      )}
    >
      <RadixAvatar.Fallback delayMs={0}>{initials || "?"}</RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
