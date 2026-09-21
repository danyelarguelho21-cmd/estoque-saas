# Feature: SaaS de Gestão de Estoque por Assinatura (estoque-saas)

**Status:** Draft
**Date:** 2026-09-21
**Last Updated:** 2026-09-21

## Problem Statement

PMEs brasileiras (varejo, distribuidoras, farmácias, mercados) gerenciam estoque em planilhas ou sistemas legados desconectados de vendas e fornecedores. Isso causa ruptura de estoque, perdas por vencimento não controlado, falta de visibilidade sobre giro/curva ABC, e dificuldade de operar múltiplas lojas/depósitos de forma consolidada. Não existe solução SaaS acessível, multi-tenant e pensada para o fluxo de trabalho brasileiro (importação de XML de NF-e do fornecedor, cobrança via Pix/boleto/cartão).

## Proposed Solution

SaaS multi-tenant, vendido por assinatura recorrente, que centraliza: cadastro de produtos, entradas de estoque (manual e via importação de XML de NF-e), saídas (venda/perda/transferência), controle de validade/lote com lógica FEFO, registro de vendas, dashboards analíticos (curva ABC, giro de estoque, produtos parados/mais vendidos), controle de acesso por papel e auditoria completa de movimentações. Cobrança recorrente via PagBank (cartão de crédito nativo) complementada por cobrança avulsa mensal (Pix/boleto) para quem não usa cartão.

## User Personas

| Persona | Papel | Necessidades principais |
|---|---|---|
| Dono/gerente de loja | Admin do tenant | Configurar empresa/lojas/usuários, ver dashboards, gerenciar assinatura |
| Operador de estoque | Operador | Cadastrar produtos, dar entrada/saída, controlar lotes/validade, transferências |
| Vendedor | Vendedor | Registrar vendas, consultar estoque, ver histórico de clientes |
| Dono do SaaS | Admin da plataforma (super-admin) | Gerenciar assinantes, planos, inadimplência, métricas de uso, painel interno separado do produto do cliente |

## User Stories

### Epic 1 — Cadastro e Multi-tenant
- Como admin, quero criar minha empresa e primeira loja no onboarding self-service, para começar a usar o sistema sem suporte manual.
- Como admin, quero convidar usuários e atribuir papéis (admin, operador, vendedor), para controlar quem faz o quê.
- Como admin, quero que os dados da minha empresa sejam totalmente isolados dos de outras empresas clientes do SaaS.
- Como admin, quero criar lojas/depósitos adicionais (respeitando o limite do meu plano), para gerenciar múltiplos pontos de venda/armazenamento.
- Como admin, quero escolher se o estoque das minhas lojas é consolidado ou separado, para refletir como minha operação funciona.

### Epic 2 — Catálogo de produtos
- Como operador, quero cadastrar produtos com SKU, categoria, unidade de medida, código de barras e fornecedor, para manter o catálogo organizado.
- Como operador, quero importar/atualizar produtos em lote via CSV, para popular o catálogo rapidamente.
- Como operador, quero definir estoque mínimo por produto (por loja), para receber alertas de reposição.
- Como operador, quero marcar um produto como "perecível" e ativar controle de lote/validade apenas para os produtos que precisam desse controle.

### Epic 3 — Entradas de estoque
- Como operador, quero registrar entrada manual de estoque (produto, quantidade, custo, loja/depósito destino).
- Como operador, quero importar um XML de NF-e do fornecedor para que os itens da nota entrem automaticamente no estoque, com mapeamento por código de barras/SKU do fornecedor.
- Como operador, quero que itens do XML não reconhecidos no catálogo sejam sinalizados para cadastro rápido antes da confirmação da entrada — a entrada só é confirmada após revisão explícita.
- Como operador, quero registrar lote e data de validade na entrada de produtos perecíveis (manual ou extraído do XML quando disponível).

### Epic 4 — Saídas de estoque
- Como vendedor, quero registrar uma venda que debita o estoque automaticamente.
- Como operador, quero registrar saída por perda/quebra/vencimento, com motivo obrigatório, mantendo o estoque real e auditável.
- Como operador, quero transferir estoque entre lojas/depósitos da mesma empresa, com rastreio de origem e destino.
- Como operador, quero que o sistema sugira a saída dos lotes mais próximos do vencimento primeiro (FEFO) ao registrar saída de produto perecível, podendo eu sobrepor manualmente a sugestão.

### Epic 5 — Vendas e clientes
- Como vendedor, quero registrar vendas com itens, quantidades e forma de pagamento (campo informativo da venda ao cliente final, não integrado a gateway).
- Como admin, quero ver histórico de compras por cliente.
- Como admin, quero relatório de faturamento por período e por loja.

### Epic 6 — Alertas e validade
- Como operador, quero configurar o estoque mínimo por produto (global ou por loja) e receber alerta quando abaixo do limite.
- Como operador, quero configurar quantos dias antes do vencimento quero ser alertado (ex: 30/15/7), por empresa, com possibilidade de sobrepor por produto.
- Como operador, quero ver uma lista consolidada de lotes vencendo, ordenada por proximidade da data.

### Epic 7 — Dashboards e analytics
- Como admin, quero ver a curva ABC de produtos (por faturamento e por quantidade).
- Como admin, quero ver giro de estoque por produto e por categoria.
- Como admin, quero identificar produtos parados (sem movimento em X dias configurável).
- Como admin, quero ver os produtos mais vendidos por período.

### Epic 8 — Controle de acesso e auditoria
- Como admin, quero definir permissões por papel (admin, operador, vendedor) sobre telas e ações do sistema.
- Como admin, quero um log de auditoria imutável de todas as movimentações de estoque (quem, o quê, quando, valores antes/depois).

### Epic 9 — Assinatura e cobrança (SaaS)
- Como admin, quero assinar um plano (Básico/Pro/Enterprise) no onboarding, escolhendo cartão (recorrência automática via PagBank) ou Pix/boleto (cobrança mensal avulsa gerada automaticamente pelo sistema).
- Como admin, quero ver minha fatura atual e histórico de pagamentos.
- Como admin, quero ser avisado ao me aproximar dos limites do meu plano (produtos, usuários, lojas).
- Como admin, quero fazer upgrade/downgrade do meu plano a qualquer momento.
- Como dono do SaaS, quero um painel administrativo interno (separado do produto do cliente) para ver todos os assinantes, MRR, churn, inadimplência, e poder suspender/reativar contas manualmente.

## Acceptance Criteria (amostra representativa)

- [ ] Dado um XML de NF-e válido, quando o operador faz upload, então o sistema lista os itens da nota, sinaliza produtos não cadastrados, e só grava a entrada em estoque após confirmação explícita do operador.
- [ ] Dado um produto com estoque abaixo do mínimo configurado, então ele aparece na lista de "alertas de estoque baixo" em até 1 minuto após a movimentação que causou a queda.
- [ ] Dado um produto perecível com lotes cadastrados, quando o operador registra uma saída sem especificar lote, então o sistema sugere automaticamente o(s) lote(s) com vencimento mais próximo (FEFO) até atingir a quantidade solicitada, permitindo sobreposição manual.
- [ ] Dado um lote a X dias do vencimento (X configurável: 30/15/7), então ele aparece na lista de alertas de validade correspondente.
- [ ] Dado um usuário com papel "vendedor", quando ele tenta acessar configurações de empresa ou cadastro de usuários, então o sistema nega o acesso (403) e não expõe dados da tela.
- [ ] Toda movimentação de estoque (entrada, saída, transferência, ajuste) gera um registro de auditoria imutável com usuário, timestamp, tipo, quantidade e saldo resultante.
- [ ] Dado que uma empresa atinge o limite de produtos/usuários/lojas do seu plano, então o sistema bloqueia a criação de novos registros do tipo excedido e exibe CTA de upgrade — a verificação é em tempo real, não em batch.
- [ ] Dado um pagamento de assinatura via cartão recusado pelo PagBank, então o sistema marca a assinatura como inadimplente, notifica o admin, e aplica a política de carência antes de restringir acesso.
- [ ] Dado um cliente que optou por Pix/boleto, então o sistema gera automaticamente a cobrança do próximo ciclo N dias antes do vencimento e concilia o pagamento (webhook) para manter a assinatura ativa.
- [ ] Dado dois tenants distintos, nenhuma consulta deve retornar registros de outro tenant — isolamento reforçado em nível de banco (Row-Level Security), não apenas filtro de aplicação.

## Business Rules

- Isolamento multi-tenant é obrigatório e reforçado em nível de banco (Row-Level Security), não apenas na camada de aplicação.
- FEFO é sugestão, não bloqueio automático — o operador pode escolher lote manualmente; o sistema registra quando a sugestão foi ignorada.
- Limites de plano (produtos, usuários, lojas) são verificados em tempo real na criação de novos registros.
- Emissão fiscal de venda (NF-e/NFC-e) está fora de escopo do MVP — o sistema apenas lê/importa XML de NF-e de entrada.
- Papéis do produto: **Admin** (acesso total ao tenant, incluindo assinatura/cobrança), **Operador de estoque** (catálogo, entradas, saídas, transferências, alertas), **Vendedor** (registrar vendas, consultar estoque e histórico de clientes — sem acesso a configurações, custos de fornecedor ou cobrança).
- Estoque consolidado vs. separado por loja é uma configuração por empresa, aplicada a todas as lojas do tenant.
- Cobrança de assinatura: cartão via PagBank (recorrência nativa). Pix/boleto via cobrança avulsa mensal gerada pelo sistema com N dias de antecedência do vencimento, reconciliada por webhook/consulta ao gateway.

## Out of Scope (MVP)

- Emissão de NF-e/NFC-e de venda (certificado digital, homologação SEFAZ) — via integração futura com provedor terceiro (v2).
- App mobile nativo / PDV físico com hardware fiscal — MVP é web responsivo.
- Recorrência nativa Pix/boleto — mitigada com cobrança avulsa mensal (ver regras de negócio); revisitar se o gateway lançar o recurso.
- Marketplace / integração com canais de venda online (e-commerce).
- Operação multi-moeda / fora do Brasil.
- Split de pagamento entre múltiplos CNPJs dentro do mesmo tenant — cada CNPJ é um tenant separado por ora.

## Open Questions

- Política exata de carência/suspensão por inadimplência (quantos dias de acesso reduzido antes de bloquear?) — a refinar com o CEO antes do fechamento do fluxo de cobrança em BUILD.
- Se/quando o PagBank lançar Pix/boleto recorrente nativo, avaliar migração do fluxo de cobrança avulsa para o nativo (arquitetura já abstrai o provedor de pagamento para permitir essa troca).

## Research Notes

Ver `research-notes.md`.
