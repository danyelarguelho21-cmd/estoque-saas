"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

interface ToastMessage {
  id: string;
  title: string;
  description?: string | undefined;
  variant: ToastVariant;
}

interface ToastContextValue {
  notify: (toast: Omit<ToastMessage, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_ICON: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: "border-l-4 border-l-[var(--color-success)]",
  error: "border-l-4 border-l-[var(--color-danger)]",
  info: "border-l-4 border-l-[var(--color-info)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((toast: Omit<ToastMessage, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      <RadixToast.Provider swipeDirection="right" duration={5000}>
        {children}
        {toasts.map((toast) => {
          const Icon = VARIANT_ICON[toast.variant];
          return (
            <RadixToast.Root
              key={toast.id}
              className={cn(
                "rounded-md bg-white p-4 shadow-lg ring-1 ring-black/5 data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full data-[state=closed]:animate-out data-[state=closed]:fade-out",
                VARIANT_CLASS[toast.variant],
              )}
              onOpenChange={(open) => {
                if (!open) dismiss(toast.id);
              }}
            >
              <div className="flex items-start gap-3">
                <Icon
                  className={cn(
                    "mt-0.5 h-5 w-5 shrink-0",
                    toast.variant === "success" && "text-[var(--color-success)]",
                    toast.variant === "error" && "text-[var(--color-danger)]",
                    toast.variant === "info" && "text-[var(--color-info)]",
                  )}
                  aria-hidden
                />
                <div className="flex-1">
                  <RadixToast.Title className="text-sm font-medium text-slate-900">
                    {toast.title}
                  </RadixToast.Title>
                  {toast.description && (
                    <RadixToast.Description className="mt-1 text-sm text-slate-500">
                      {toast.description}
                    </RadixToast.Description>
                  )}
                </div>
                <RadixToast.Close aria-label="Fechar notificação" className="text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </RadixToast.Close>
              </div>
            </RadixToast.Root>
          );
        })}
        <RadixToast.Viewport className="fixed bottom-0 right-0 z-[100] m-0 flex w-full max-w-sm list-none flex-col gap-2 p-6 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
