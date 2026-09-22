"use client";

import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Checkbox({ id, checked, onCheckedChange, disabled, ...aria }: CheckboxProps) {
  return (
    <RadixCheckbox.Root
      id={id}
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      disabled={disabled}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--color-border)] bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] data-[state=checked]:border-[var(--color-primary)] data-[state=checked]:bg-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50",
      )}
      {...aria}
    >
      <RadixCheckbox.Indicator>
        <Check className="h-3 w-3 text-white" aria-hidden />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
