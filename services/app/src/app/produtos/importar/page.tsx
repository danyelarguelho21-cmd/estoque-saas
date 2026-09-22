"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/features/file-drop";
import { catalogApi } from "@/lib/api/catalog";

export default function ImportProductsPage() {
  const [status, setStatus] = useState<"idle" | "uploading" | "queued" | "error">("idle");
  const [importJobId, setImportJobId] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    try {
      const result = await catalogApi.importProductsCsv(file);
      setImportJobId(result.importJobId);
      setStatus("queued");
    } catch {
      setStatus("error");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Importar produtos via CSV</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Atualiza ou cadastra produtos em lote. Colunas esperadas: sku, name, categoryId, unitOfMeasure, barcode,
            supplierId, isPerishable, minStockGlobal, costPriceCents, salePriceCents.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Arquivo CSV</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {status === "queued" ? (
              <Alert variant="success" title="Importação enviada">
                <p>
                  Sua planilha está sendo processada em segundo plano (job {importJobId}). Produtos novos e
                  atualizados aparecerão na lista de produtos em instantes.
                </p>
              </Alert>
            ) : (
              <FileDrop
                accept=".csv,text/csv"
                label="Arraste o arquivo CSV ou clique para selecionar"
                hint="Tamanho máximo recomendado: 5.000 linhas por arquivo"
                onFileSelected={handleFile}
                disabled={status === "uploading"}
              />
            )}

            {status === "error" && (
              <Alert variant="danger" title="Falha no envio">
                Não foi possível enviar o arquivo. Verifique sua conexão e tente novamente.
              </Alert>
            )}

            <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
              <Button variant="ghost" asChild>
                <a href="/templates/produtos-modelo.csv" download>
                  <Download className="h-4 w-4" />
                  Baixar modelo CSV
                </a>
              </Button>
              {status === "queued" && (
                <Button asChild>
                  <Link href="/produtos">
                    <CheckCircle2 className="h-4 w-4" />
                    Ver produtos
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
