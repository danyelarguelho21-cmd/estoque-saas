# Research Notes — estoque-saas

## Gateway de pagamento (cobrança recorrente)

Restrição do usuário: não pode usar Mercado Pago nem Asaas.

- **Pagar.me (grupo Stone)** — API v5 de recorrência madura, com suporte nativo a cartão, Pix e boleto em assinaturas, split de pagamentos, SDKs oficiais. Fonte: docs.pagar.me/v2/docs/overview-recorrência, docs.pagar.me/docs/overview-recorrência (pesquisado set/2026).
- **Iugu** — suporta assinaturas com split de pagamento (cartão, boleto, Pix, carnê), mas há reclamações recorrentes em 2025/2026 no Reclame Aqui sobre retenção de repasses e cancelamento unilateral de contas com bloqueio de saldo. Risco considerado alto para peça central de faturamento do SaaS. **Não recomendado.**
- **PagBank/PagSeguro** — escolhido pelo usuário. Possui produto de "Pagamentos Recorrentes" (developer.pagbank.com.br/docs/pagamentos-recorrentes), mas o **Checkout Recorrente hoje suporta apenas cartão de crédito**; Pix e boleto recorrentes estão listados como "em breve" na documentação, sem data confirmada (pesquisado set/2026).
  - **Decisão do usuário:** usar PagBank para recorrência via cartão; para clientes que preferem Pix/boleto, o sistema gera uma cobrança avulsa mensal (link de pagamento / QR Pix ou boleto via API de Pedidos do PagBank, que suporta Pix e boleto para cobranças avulsas) com N dias de antecedência do vencimento do ciclo, e concilia via webhook/consulta.
  - Implicação de arquitetura: a camada de cobrança deve ser abstraída atrás de uma interface própria (`PaymentProvider`), para permitir (a) migrar para recorrência nativa Pix/boleto se o PagBank lançar o recurso, e (b) trocar/adicionar outro gateway no futuro sem reescrever regras de negócio.

## NF-e (Nota Fiscal Eletrônica) — importação de XML

- O MVP faz apenas **leitura/importação de XML de NF-e de entrada** (nota do fornecedor), não emissão. Isso evita a complexidade de certificado digital (A1/A3), homologação com SEFAZ por estado e contingência — que ficam fora de escopo.
- XML de NF-e segue o layout padrão da SEFAZ (schema `procNFe`/`nfeProc`, tags `det` para itens, `prod` para dados do produto: `cProd`, `cEAN`/`cEANTrib` código de barras, `xProd` descrição, `uCom` unidade, `qCom` quantidade, `vUnCom` valor unitário). O mapeamento de itens do XML para produtos cadastrados deve usar `cEAN`/código de barras como chave primária de correspondência, com fallback para cadastro manual quando não encontrado.

## Segmento e escopo do MVP

- Usuário optou por um produto **genérico para varejo e distribuidoras**, com controle de validade/lote/FEFO como **módulo opcional configurável por empresa** (ativável para farmácias/mercados), em vez de ser o fluxo central obrigatório.

## Modelo de planos

- Mensalidade fixa por faixa de limites (Básico/Pro/Enterprise), conforme decisão do usuário. Valores exatos de precificação ficam para definição comercial posterior (fora do escopo técnico do BRD) — a arquitetura deve permitir configurar limites por plano (produtos, usuários, lojas) de forma flexível via tabela de planos, não hardcoded.
