# Constraints — estoque-saas

## Negócio
- Mercado: PMEs brasileiras (varejo, distribuidoras, farmácias, mercados).
- Modelo: SaaS por assinatura recorrente, planos Básico/Pro/Enterprise com limites de produtos/usuários/lojas.
- Gateway de pagamento: PagBank/PagSeguro (cartão recorrente nativo) + cobrança avulsa mensal Pix/boleto gerada pelo sistema. Proibido usar Mercado Pago e Asaas (restrição explícita do usuário).
- Fora de escopo no MVP: emissão fiscal própria, app mobile nativo/PDV com hardware fiscal, e-commerce/marketplace, multi-moeda, split entre múltiplos CNPJs no mesmo tenant.

## Técnico
- Multi-tenant com isolamento de dados obrigatório por empresa cliente, reforçado em nível de banco (não apenas filtro de aplicação).
- Stack sugerida pelo usuário: Next.js + Postgres — aberto a alternativa melhor para multi-tenant robusto (decisão técnica cabe ao Solution Architect).
- Ambiente local para desenvolvimento/testes agora; pipeline completo (incluindo CI/CD e infraestrutura) deve ser produzido mesmo sem deploy imediato, pois o usuário optou pelo pipeline production-grade completo.
- Importação de XML de NF-e segue o layout padrão SEFAZ; sistema deve suportar conferência manual antes de confirmar entrada em estoque.

## Regulatório
- LGPD: dados de clientes finais das lojas (histórico de compras) e dados dos próprios assinantes (empresas/usuários) devem seguir princípios de minimização e finalidade — tratar como requisito de segurança/privacidade a ser detalhado pelo Security Engineer na fase HARDEN.
- Sem obrigação de emissão fiscal no MVP (fora de escopo), o que reduz superfície de compliance fiscal, mas NÃO reduz a responsabilidade sobre dados pessoais (LGPD) e financeiros (dados de cobrança).

## Organizacionais
- Engajamento do usuário no pipeline: Standard (3 gates + entrevista moderada).
- Paralelismo: máximo, com isolamento por git worktree.
