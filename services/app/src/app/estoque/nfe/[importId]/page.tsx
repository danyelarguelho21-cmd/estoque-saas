"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, CircleDot } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSpinner } from "@/components/ui/spinner";
import { NfeQuickCreateDialog } from "@/components/features/nfe-quick-create-dialog";
import { useToast } from "@/components/ui/toast";
import { stockApi } from "@/lib/api/stock";
import { ApiError } from "@/lib/api/client";
import { formatCentsToBRL } from "@/lib/format";
import type { NfeImportItemStatus } from "@/lib/api/types";

const STATUS_LABEL: Record<NfeImportItemStatus, string> = {
  matched: "Reconhecido",
  created: "Recém-cadastrado",
  unmatched: "Não reconhecido",
};

export default function NfeReviewPage({ params }: { params: Promise<{ importId: string }> }) {
  const { importId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const [batchInputs, setBatchInputs] = useState<Record<string, { batchNumber: string; expiryDate: string }>>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const importQuery = useQuery({
    queryKey: ["nfe-import", importId],
    queryFn: () => stockApi.getNfeImport(importId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending_parse" ? 2000 : false;
    },
  });

  const data = importQuery.data;
  const hasUnmatched = data?.items.some((item) => item.status === "unmatched") ?? true;

  function updateBatch(itemId: string, patch: Partial<{ batchNumber: string; expiryDate: string }>) {
    setBatchInputs((prev) => ({
      ...prev,
      [itemId]: { batchNumber: prev[itemId]?.batchNumber ?? "", expiryDate: prev[itemId]?.expiryDate ?? "", ...patch },
    }));
  }

  async function handleConfirm() {
    if (!data) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await stockApi.confirmNfeImport(
        importId,
        data.items
          .filter((item) => item.status !== "unmatched")
          .map((item) => {
            const input = batchInputs[item.id];
            return {
              nfeImportItemId: item.id,
              ...(input?.batchNumber ? { batchNumber: input.batchNumber } : {}),
              ...(input?.expiryDate ? { expiryDate: input.expiryDate } : {}),
            };
          }),
      );
      notify({ title: "Importação confirmada — estoque atualizado", variant: "success" });
      router.push("/estoque");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConfirmError("Ainda há itens não reconhecidos. Cadastre-os antes de confirmar.");
      } else {
        setConfirmError("Não foi possível confirmar a importação agora. Tente novamente.");
      }
    } finally {
      setConfirming(false);
    }
  }

  if (importQuery.isLoading) {
    return (
      <AppShell>
        <PageSpinner label="Carregando conferência…" />
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell>
        <Alert variant="danger" title="Importação não encontrada" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Conferência de NF-e</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Nenhuma movimentação de estoque é criada até você confirmar explicitamente abaixo.
          </p>
        </div>

        {data.status === "pending_parse" && (
          <Alert variant="info" title="Processando XML">
            <span className="inline-flex items-center gap-2">
              <CircleDot className="h-4 w-4 animate-pulse" aria-hidden />
              Isso costuma levar poucos segundos — a lista de itens aparece automaticamente.
            </span>
          </Alert>
        )}
        {data.status === "failed" && (
          <Alert variant="danger" title="Falha ao processar o XML">
            Verifique se o arquivo é um XML de NF-e válido (schema nfeProc/procNFe) e tente enviar novamente.
          </Alert>
        )}
        {data.status === "confirmed" && (
          <Alert variant="success" title="Importação já confirmada">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              O estoque desta nota já foi atualizado.
            </span>
          </Alert>
        )}

        {(data.status === "pending_review" || data.status === "confirmed") && (
          <Card>
            <CardHeader>
              <CardTitle>Itens da nota ({data.items.length})</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição (XML)</TableHead>
                  <TableHead>Qtd.</TableHead>
                  <TableHead>Valor unit.</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Lote / validade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{item.xProd}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        cProd {item.cProd} {item.cEAN && `· EAN ${item.cEAN}`}
                      </p>
                    </TableCell>
                    <TableCell>{item.qCom}</TableCell>
                    <TableCell>{formatCentsToBRL(item.vUnComCents)}</TableCell>
                    <TableCell>
                      {item.status === "unmatched" ? (
                        <div className="flex flex-col items-start gap-2">
                          <Badge variant="danger">
                            <CircleAlert className="mr-1 h-3 w-3" aria-hidden />
                            {STATUS_LABEL[item.status]}
                          </Badge>
                          {data.status === "pending_review" && (
                            <NfeQuickCreateDialog
                              importId={importId}
                              item={item}
                              onCreated={() => {
                                notify({ title: "Produto cadastrado — atualizando conferência", variant: "info" });
                                void queryClient.invalidateQueries({ queryKey: ["nfe-import", importId] });
                              }}
                            />
                          )}
                        </div>
                      ) : (
                        <Badge variant={item.status === "created" ? "info" : "success"}>{STATUS_LABEL[item.status]}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.status !== "unmatched" && data.status === "pending_review" && (
                        <div className="flex gap-2">
                          <Input
                            aria-label="Número do lote"
                            placeholder="Lote"
                            className="w-24"
                            value={batchInputs[item.id]?.batchNumber ?? ""}
                            onChange={(e) => updateBatch(item.id, { batchNumber: e.target.value })}
                          />
                          <Input
                            aria-label="Data de validade"
                            type="date"
                            className="w-40"
                            value={batchInputs[item.id]?.expiryDate ?? ""}
                            onChange={(e) => updateBatch(item.id, { expiryDate: e.target.value })}
                          />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {data.status === "pending_review" && (
          <Card>
            <CardContent className="flex flex-col gap-3">
              {confirmError && (
                <Alert variant="danger" title="Não foi possível confirmar">
                  {confirmError}
                </Alert>
              )}
              {hasUnmatched && (
                <Alert variant="warning">
                  Cadastre todos os itens não reconhecidos antes de confirmar a entrada em estoque.
                </Alert>
              )}
              <Button onClick={handleConfirm} loading={confirming} disabled={hasUnmatched} className="w-full sm:w-auto sm:self-end">
                Confirmar importação e atualizar estoque
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
