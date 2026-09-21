# ADR-005: Importação de XML de NF-e de entrada

**Status:** Accepted
**Context:** BRD Epic 3 exige que o operador importe um XML de NF-e do fornecedor e que os itens entrem automaticamente no estoque, com conferência antes de confirmar. Fora de escopo: emissão de NF-e (ver BRD "Out of Scope"). O XML de entrada segue o schema padrão SEFAZ (`nfeProc`/`procNFe`), com itens em `det/prod` (`cProd`, `cEAN`/`cEANTrib`, `xProd`, `uCom`, `qCom`, `vUnCom`, `vProd`).
**Decision:**
1. Upload do XML acontece via UI (multipart) → gravado em storage de arquivos (volume local em dev, compatível com S3/MinIO em produção via interface `FileStorage`) → um job assíncrono (BullMQ) faz o parsing (biblioteca `fast-xml-parser`) e persiste um registro `nfe_imports` (status `pending_review`) e um `nfe_import_items` por item do XML.
2. Cada item é correlacionado a um produto existente do tenant por `cEAN`/código de barras; se não houver correspondência, o item fica marcado `unmatched` e a UI oferece cadastro rápido do produto sem sair da tela de conferência.
3. **Nenhuma movimentação de estoque é criada até o operador confirmar explicitamente** a importação na tela de conferência — atende ao critério de aceite do BRD. Ao confirmar, o sistema cria uma linha de `stock_movements` (`type = entrada_nfe`) por item, e um `batches` (lote) se o produto for perecível (o XML raramente traz validade — o operador informa manualmente na tela de conferência quando aplicável).
4. O processamento é assíncrono (job), não bloqueia a requisição de upload — a UI faz polling leve do status do import (compatível com a decisão de "sem tempo real" da discovery).
**Consequences:** Parsing pesado não trava o servidor web; erros de parsing (XML malformado, schema inesperado) ficam isolados no job e reportados como `status = failed` com mensagem, sem derrubar a request original. A dependência em `cEAN` como chave de correspondência é uma limitação conhecida — nem todo fornecedor preenche EAN corretamente; por isso o fallback de cadastro manual/rápido é parte obrigatória do fluxo, não um caso de borda.
**Alternatives Considered:**
- **Parsing síncrono na própria request HTTP:** mais simples, mas XMLs grandes (notas com centenas de itens) podem estourar timeout de request. Rejeitado.
- **Confirmar automaticamente sem revisão:** rejeitado diretamente pelo BRD (critério de aceite explícito exige revisão humana antes da entrada em estoque).
