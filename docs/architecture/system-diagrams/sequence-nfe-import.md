# Sequência — Importação de XML de NF-e

```mermaid
sequenceDiagram
    actor Operador
    participant Web as App Next.js
    participant Storage as File Storage
    participant Queue as Redis/BullMQ
    participant Worker as Worker
    participant DB as PostgreSQL

    Operador->>Web: Upload XML de NF-e
    Web->>Storage: Grava arquivo
    Web->>DB: INSERT nfe_imports (status=pending_parse)
    Web->>Queue: Enfileira job parse-nfe
    Web-->>Operador: 202 Accepted (import_id)

    Queue->>Worker: Job parse-nfe
    Worker->>Storage: Lê XML
    Worker->>Worker: Parse (fast-xml-parser) + valida schema SEFAZ
    Worker->>DB: INSERT nfe_import_items (por item, tenta match por cEAN)
    Worker->>DB: UPDATE nfe_imports SET status=pending_review

    loop Polling leve da UI
        Operador->>Web: GET /nfe-imports/:id
        Web->>DB: SELECT nfe_imports + items
        Web-->>Operador: status + itens (matched/unmatched)
    end

    Operador->>Web: Cadastra rápido produtos unmatched (se houver)
    Operador->>Web: Confirma importação
    Web->>DB: BEGIN TRANSACTION
    Web->>DB: INSERT stock_movements (type=entrada_nfe) por item
    Web->>DB: INSERT/UPDATE batches (se produto perecível e validade informada)
    Web->>DB: INSERT audit_log
    Web->>DB: UPDATE nfe_imports SET status=confirmed
    Web->>DB: COMMIT
    Web-->>Operador: Estoque atualizado
```

Cobre o Pattern 5 do boundary-safety protocol: o teste e2e desta jornada verifica o estado final (saldo de estoque atualizado), não apenas que cada chamada individual retornou 200.
