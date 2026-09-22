"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value?: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  "aria-label"?: string | undefined;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Selecione…",
  id,
  disabled,
  invalid = false,
  ...aria
}: SelectProps) {
  const rootValueProp = value === undefined ? {} : { value };

  return (
    <RadixSelect.Root {...rootValueProp} onValueChange={onValueChange} disabled={disabled ?? false}>
      <RadixSelect.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-[var(--color-border)] bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-slate-400",
          invalid && "border-[var(--color-danger)]",
        )}
        {...aria}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-md border border-[var(--color-border)] bg-white shadow-lg"
          position="popper"
          sideOffset={4}
        >
          <RadixSelect.Viewport className="p-1">
            {options.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-slate-400">Nenhuma opção disponível</p>
            )}
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled ?? false}
                className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm text-slate-900 outline-none data-[highlighted]:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2 inline-flex items-center">
                  <Check className="h-4 w-4" aria-hidden />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
