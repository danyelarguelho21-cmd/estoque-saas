# ERD — estoque-saas

Todas as tabelas marcadas `[tenant]` têm `tenant_id` e RLS habilitada (ADR-002). Tabelas sem a marca são globais (fora do RLS de tenant).

```mermaid
erDiagram
    PLANS ||--o{ SUBSCRIPTIONS : "assinado por"
    TENANTS ||--o{ SUBSCRIPTIONS : "tem"
    TENANTS ||--o{ STORES : "tem"
    TENANTS ||--o{ USERS : "tem"
    TENANTS ||--o{ SUPPLIERS : "tem"
    TENANTS ||--o{ CATEGORIES : "tem"
    TENANTS ||--o{ PRODUCTS : "tem"
    TENANTS ||--o{ CUSTOMERS : "tem"
    TENANTS ||--o{ AUDIT_LOG : "gera"

    SUBSCRIPTIONS ||--o{ INVOICES : "gera"

    STORES ||--o{ PRODUCT_STORE_SETTINGS : "config por loja"
    PRODUCTS ||--o{ PRODUCT_STORE_SETTINGS : "config por loja"
    PRODUCTS ||--o{ BATCHES : "possui lotes"
    STORES ||--o{ BATCHES : "armazena"
    PRODUCTS ||--o{ STOCK_MOVEMENTS : "movimenta"
    STORES ||--o{ STOCK_MOVEMENTS : "local"
    BATCHES ||--o{ STOCK_MOVEMENTS : "referencia (opcional)"
    USERS ||--o{ STOCK_MOVEMENTS : "executa"

    SUPPLIERS ||--o{ PRODUCTS : "fornece"
    SUPPLIERS ||--o{ NFE_IMPORTS : "origem"
    NFE_IMPORTS ||--o{ NFE_IMPORT_ITEMS : "contém"
    PRODUCTS ||--o{ NFE_IMPORT_ITEMS : "match opcional"
    STORES ||--o{ NFE_IMPORTS : "destino"

    STORES ||--o{ SALES : "local"
    CUSTOMERS ||--o{ SALES : "compra"
    USERS ||--o{ SALES : "vende"
    SALES ||--o{ SALE_ITEMS : "contém"
    PRODUCTS ||--o{ SALE_ITEMS : "vendido"
    BATCHES ||--o{ SALE_ITEMS : "origem (opcional)"

    STORES ||--o{ TRANSFERS : "origem/destino"
    TRANSFERS ||--o{ TRANSFER_ITEMS : "contém"
    PRODUCTS ||--o{ TRANSFER_ITEMS : "transferido"

    TENANTS {
        uuid id PK
        string name
        string cnpj
        uuid plan_id FK
        bool consolidated_stock
        bool perishable_tracking_enabled
        timestamp created_at
    }
    PLANS {
        uuid id PK
        string name
        int price_cents
        int max_products
        int max_users
        int max_stores
        jsonb features
    }
    SUBSCRIPTIONS {
        uuid id PK
        uuid tenant_id FK
        uuid plan_id FK
        string status
        string payment_method
        string gateway_subscription_id
        timestamp current_period_start
        timestamp current_period_end
    }
    INVOICES {
        uuid id PK
        uuid tenant_id FK
        uuid subscription_id FK
        int amount_cents
        string status
        date due_date
        timestamp paid_at
        string gateway_charge_id
        string gateway_event_id
    }
    USERS {
        uuid id PK
        uuid tenant_id FK
        string name
        string email
        string password_hash
        string role
        string status
        timestamp created_at
    }
    STORES {
        uuid id PK
        uuid tenant_id FK
        string name
        string type
        string address
    }
    SUPPLIERS {
        uuid id PK
        uuid tenant_id FK
        string name
        string cnpj
    }
    CATEGORIES {
        uuid id PK
        uuid tenant_id FK
        string name
    }
    PRODUCTS {
        uuid id PK
        uuid tenant_id FK
        string sku
        string name
        uuid category_id FK
        string unit_of_measure
        string barcode
        uuid supplier_id FK
        bool is_perishable
        int min_stock_global
        int cost_price_cents
        int sale_price_cents
        timestamp deleted_at
    }
    PRODUCT_STORE_SETTINGS {
        uuid product_id FK
        uuid store_id FK
        int min_stock_override
    }
    BATCHES {
        uuid id PK
        uuid product_id FK
        uuid store_id FK
        string batch_number
        date expiry_date
        int quantity
        timestamp received_at
    }
    STOCK_MOVEMENTS {
        uuid id PK
        uuid tenant_id FK
        uuid product_id FK
        uuid store_id FK
        uuid batch_id FK
        string type
        int quantity
        int unit_cost_cents
        uuid reference_id
        uuid created_by FK
        jsonb metadata
        int balance_after
        timestamp created_at
    }
    NFE_IMPORTS {
        uuid id PK
        uuid tenant_id FK
        uuid store_id FK
        uuid supplier_id FK
        string access_key
        string file_ref
        string status
        uuid confirmed_by FK
        timestamp confirmed_at
    }
    NFE_IMPORT_ITEMS {
        uuid id PK
        uuid nfe_import_id FK
        string c_prod
        string c_ean
        string x_prod
        decimal q_com
        int v_un_com_cents
        uuid matched_product_id FK
        string status
    }
    CUSTOMERS {
        uuid id PK
        uuid tenant_id FK
        string name
        string document
        string phone
    }
    SALES {
        uuid id PK
        uuid tenant_id FK
        uuid store_id FK
        uuid customer_id FK
        uuid seller_id FK
        int total_amount_cents
        string payment_method_label
        string status
        timestamp created_at
    }
    SALE_ITEMS {
        uuid id PK
        uuid sale_id FK
        uuid product_id FK
        uuid batch_id FK
        int quantity
        int unit_price_cents
    }
    TRANSFERS {
        uuid id PK
        uuid tenant_id FK
        uuid origin_store_id FK
        uuid destination_store_id FK
        string status
        uuid created_by FK
        timestamp created_at
    }
    TRANSFER_ITEMS {
        uuid id PK
        uuid transfer_id FK
        uuid product_id FK
        uuid batch_id FK
        int quantity
    }
    AUDIT_LOG {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        string entity_type
        uuid entity_id
        string action
        jsonb before
        jsonb after
        timestamp created_at
    }
    PLATFORM_ADMINS {
        uuid id PK
        string name
        string email
        string password_hash
    }
```

## Notas de modelagem
- **Saldo de estoque** não é uma tabela própria materializada separadamente — é derivado somando `stock_movements.quantity` (com sinal) por `product_id + store_id`, e cada movimento grava `balance_after` para leitura rápida sem recomputar a soma inteira a cada consulta (trade-off: leve redundância controlada, não fonte de verdade dupla — `balance_after` é sempre recalculável a partir do histórico).
- `stock_movements.reference_id` aponta para `sales.id`, `transfers.id` ou `nfe_imports.id` dependendo do `type` — polimorfismo simples via UUID + `type`, sem FK direta (documentado, validado em nível de aplicação e coberto por teste).
- `PLANS` e `PLATFORM_ADMINS` são as únicas tabelas sem `tenant_id` — não participam do RLS de tenant (ADR-002).
- Todas as tabelas `[tenant]` (todas exceto `PLANS` e `PLATFORM_ADMINS`) têm `tenant_id` direto, mesmo quando alcançável via join (ex: `stock_movements.tenant_id` mesmo existindo `product_id → products.tenant_id`) — decisão da ADR-002 para manter a política RLS auto-contida.
