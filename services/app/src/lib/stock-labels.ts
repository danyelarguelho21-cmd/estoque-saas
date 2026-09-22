import type { StockMovementType } from "@/lib/api/types";

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  entrada_manual: "Entrada manual",
  entrada_nfe: "Entrada (NF-e)",
  saida_venda: "Saída (venda)",
  saida_perda: "Saída (perda/quebra)",
  transferencia_saida: "Transferência (saída)",
  transferencia_entrada: "Transferência (entrada)",
  ajuste: "Ajuste",
};

export const STOCK_MOVEMENT_BADGE: Record<StockMovementType, "success" | "danger" | "info" | "neutral"> = {
  entrada_manual: "success",
  entrada_nfe: "success",
  saida_venda: "info",
  saida_perda: "danger",
  transferencia_saida: "neutral",
  transferencia_entrada: "neutral",
  ajuste: "neutral",
};
