import QRCode from "qrcode";
import { withTenant } from "@estoque-saas/shared";
import { getPaymentProvider } from "./provider";

export interface ListInvoicesFilters {
  cursor?: string | undefined;
  limit?: number | undefined;
}

interface InvoiceRow {
  id: string;
  paymentMethod: string;
  pixQrCode: string | null;
  pixQrCodeImageUrl: string | null;
}

// pixQrCodeImageUrl na resposta da API é sempre a rota interna /api/billing/invoices/{id}/pix-qr
// (a imagem é gerada aqui no servidor a partir do copia-e-cola) — nunca a URL do gateway, que o
// navegador nem conseguiria carregar sob a CSP img-src 'self'.
export function toInvoiceResponse<T extends InvoiceRow>(invoice: T): T {
  const hasQr = invoice.paymentMethod === "pix" && Boolean(invoice.pixQrCode || invoice.pixQrCodeImageUrl);
  return { ...invoice, pixQrCodeImageUrl: hasQr ? `/api/billing/invoices/${invoice.id}/pix-qr` : null };
}

export async function listInvoices(tenantId: string, filters: ListInvoicesFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const invoices = await tx.invoice.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = invoices.length > limit;
    const page = hasMore ? invoices.slice(0, limit) : invoices;
    return { items: page.map(toInvoiceResponse), page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
  });
}

// PNG do QR Code Pix gerado a partir do copia-e-cola (EMV) gravado na fatura — não depende de
// imagem hospedada no gateway (a Vindi nem expõe uma via API; ver VindiProvider.fetchPixQrCodeImage).
// Faturas antigas do PagBank que só tenham a URL da imagem continuam caindo no provider.
export async function getPixQrCodeImage(tenantId: string, invoiceId: string): Promise<Uint8Array | null> {
  const invoice = await withTenant(tenantId, (tx) =>
    tx.invoice.findFirst({
      where: { id: invoiceId, paymentMethod: "pix" },
      select: { pixQrCode: true, pixQrCodeImageUrl: true },
    }),
  );
  if (invoice?.pixQrCode) {
    return QRCode.toBuffer(invoice.pixQrCode, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 392 });
  }
  if (!invoice?.pixQrCodeImageUrl) return null;
  return getPaymentProvider().fetchPixQrCodeImage(invoice.pixQrCodeImageUrl);
}
