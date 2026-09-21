import type {
  OneOffChargeInput,
  OneOffChargeResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RecurringChargeInput,
  RecurringChargeResult,
} from "../provider";

// Implementação concreta do PaymentProvider para PagBank/PagSeguro (ADR-004).
// Recorrência nativa: apenas cartão (API "Pagamentos Recorrentes").
// Pix/boleto: cobrança avulsa mensal via API de Pedidos (createOneOffCharge),
// orquestrada pelo job mensal do worker — não pelo PagBank diretamente.
//
// Implementação real (chamadas HTTP, credenciais via env) é responsabilidade da fase BUILD
// (Software Engineer). Este arquivo fixa o contrato e a fronteira de responsabilidade.
export class PagBankProvider implements PaymentProvider {
  constructor(private readonly config: { apiKey: string; baseUrl: string; webhookSecret: string }) {}

  async createRecurringCardCharge(_input: RecurringChargeInput): Promise<RecurringChargeResult> {
    throw new Error("TODO(BUILD): implementar chamada à API de Pagamentos Recorrentes do PagBank");
  }

  async createOneOffCharge(_input: OneOffChargeInput): Promise<OneOffChargeResult> {
    throw new Error("TODO(BUILD): implementar chamada à API de Pedidos do PagBank (Pix/boleto avulso)");
  }

  async cancelSubscription(_gatewaySubscriptionId: string): Promise<void> {
    throw new Error("TODO(BUILD): implementar cancelamento de recorrência no PagBank");
  }

  verifyWebhookSignature(_payload: string, _signature: string): boolean {
    throw new Error("TODO(BUILD): validar assinatura do webhook conforme documentação do PagBank");
  }

  parseWebhookEvent(_payload: unknown): PaymentWebhookEvent {
    throw new Error("TODO(BUILD): normalizar payload do PagBank para PaymentWebhookEvent");
  }
}
