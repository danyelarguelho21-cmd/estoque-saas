# Low Findings — Wave B Code Review (estoque-saas)

---

### [LO-1] Client-side PagBank.js card tokenization is a documented no-op today — no script tag loads it anywhere

**Severity:** Low (already self-documented by the author, not silently masked — flagging so it
isn't lost before SHIP)
**Category:** Code Quality
**Location:** `services/app/src/lib/payments/pagbank.ts:1-13`, used from
`services/app/src/app/cadastro/page.tsx:19`

**Description:** `tokenizeCard()`'s own header comment states this is a known gap: it checks for
`window.PagSeguro`/`window.PagBank` and throws `PagBankNotLoadedError` if absent, rather than
faking success. Confirmed by grep: no `<script>` reference to a PagBank.js asset exists anywhere
under `services/app/src/app` (checked layout files and the signup page itself) — so today,
`tokenizeCard()` will **always** throw in every environment, meaning card-based subscription
signup (`cadastro/page.tsx`'s card path) is non-functional end-to-end; only the `pix_boleto`
payment method path works. This is architecturally correct (fails loud, not silently), just
incomplete.

**Recommendation:** Track as a pre-launch checklist item (needs real PagBank production
credentials to know the correct script URL/version per the file's own comment) rather than a code
defect — no code change recommended here, just surfacing it so it isn't discovered for the first
time during a demo.

---

### [LO-2] CSV import does a `SELECT` then `INSERT` per row instead of relying on the SKU unique constraint

**Severity:** Low
**Category:** Performance (minor)
**Location:** `services/app/src/modules/catalog/csv-import.ts:15-19`

**Description:** `processProductsCsvJob` does `tx.product.findFirst({ where: { sku: row.sku, deletedAt: null } })`
before every `create`, doubling the query count for the common case (most rows aren't
duplicates). Since `sku` is presumably unique per tenant (worth confirming against the schema),
the existence check could instead be collapsed into a single `create` wrapped in a catch for the
unique-constraint-violation error code, halving round-trips for the non-duplicate path.

**Recommendation:** Low priority — correctness is unaffected either way. Consider only if CSV
import throughput becomes a measured bottleneck; not worth the code-complexity trade-off (a
try/catch keyed on Prisma's `P2002` error code) otherwise.

---

### [LO-3] Webhook events with no matching invoice/subscription are discarded with no log line

**Severity:** Low
**Category:** Code Quality (Observability)
**Location:** `services/app/src/modules/billing/webhook.ts:32-37`

**Description:** When `billing_lookup_tenant_by_gateway_ref` finds no match, the function returns
silently (`if (!match) { return; }`), with a comment explaining this is expected for
cross-environment noise (sandbox vs. production events). No log line records that an event was
received and discarded, which makes it operationally hard to distinguish "expected sandbox noise"
from "a real production charge that failed to match due to a genuine bug" after the fact.

**Recommendation:** Add a single structured `console.info`/logger call noting the discarded
`gatewayEventId`/`chargeId`/`subscriptionId` before returning, so a real mismatch is visible in
logs/monitoring rather than only discoverable by noticing a tenant's payment never landed.
