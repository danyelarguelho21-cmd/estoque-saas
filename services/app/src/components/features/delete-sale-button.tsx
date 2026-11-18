"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ManagerUnlockForm, useManagerAccess } from "@/components/features/manager-lock";
import { salesApi } from "@/lib/api/sales";
import { ApiError } from "@/lib/api/client";
import { formatCentsToBRL } from "@/lib/format";

/**
 * Botão "Apagar venda" com confirmação. Os produtos voltam para o estoque e a venda sai do caixa.
 * Vendedor precisa da senha do gestor (o formulário aparece dentro da própria janela).
 */
export function DeleteSaleButton({
  saleId,
  totalCents,
  compact = false,
  onDeleted,
}: {
  saleId: string;
  totalCents: number;
  compact?: boolean;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const { allowed } = useManagerAccess();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await salesApi.deleteSale(saleId);
      notify({ title: "Venda apagada", description: "Os produtos voltaram para o estoque.", variant: "success" });
      setOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["sale", saleId] }),
        queryClient.invalidateQueries({ queryKey: ["cash"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["monthly-sales"] }),
      ]);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível apagar a venda agora.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon" aria-label="Apagar venda" title="Apagar venda">
            <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
          </Button>
        ) : (
          <Button variant="outline">
            <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
            Apagar venda
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title="Apagar esta venda?" description={`Venda de ${formatCentsToBRL(totalCents)}.`}>
        {!allowed ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-700">Para apagar uma venda, peça para o gerente digitar a senha do gestor.</p>
            <ManagerUnlockForm compact />
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              Os produtos voltam para o estoque e a venda sai do caixa do dia. Use quando a venda foi lançada errado ou era um teste.
            </p>
            {error && (
              <Alert variant="danger" className="mt-3">
                {error}
              </Alert>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
                Cancelar
              </Button>
              <Button variant="danger" loading={deleting} onClick={handleDelete}>
                Apagar venda
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
