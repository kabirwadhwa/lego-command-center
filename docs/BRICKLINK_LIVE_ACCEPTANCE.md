# BrickLink Official Store API & Price Guide Integration Acceptance Record

- **Timestamp**: `2026-09-27T17:30:00.000Z`
- **Application**: LEGO Command Center
- **Production URL**: `https://lego-command-center-production.up.railway.app`
- **Milestone**: BrickLink Market Pricing Intelligence (Official Store API v1)
- **Integration Status**: `IMPLEMENTED_UNVERIFIED` / `NOT_CONFIGURED` (Truthful state pending credential injection into Railway environment)

---

## 1. Architectural Integrity & Implementation Summary

### Official API Architecture
- **Base Endpoint**: `https://api.bricklink.com/api/store/v1`
- **Catalog Item Verification**: `GET /items/{type}/{no}`
- **Price Guide Retrieval**: `GET /items/{type}/{no}/price`
- **OAuth 1.0 Signer**: RFC 5849 / RFC 3986 compliant HMAC-SHA1 signature generator implemented in [`src/services/bricklink/bricklinkOAuth.ts`](../src/services/bricklink/bricklinkOAuth.ts) using native `node:crypto`.
- **API Client**: Implemented in [`src/services/bricklink/bricklinkClient.ts`](../src/services/bricklink/bricklinkClient.ts) with strict runtime schema validation, preventing NaN conversion to 0.

### Supported Price Guide Modes
1. **SET + SOLD + NEW**: `guide_type=sold`, `new_or_used=N`, `currency_code=EUR`
2. **SET + SOLD + USED**: `guide_type=sold`, `new_or_used=U`, `currency_code=EUR`
3. **SET + STOCK + NEW**: `guide_type=stock`, `new_or_used=N`, `currency_code=EUR`
4. **SET + STOCK + USED**: `guide_type=stock`, `new_or_used=U`, `currency_code=EUR`

### Invariant & Compliance Gates
- **Zero Simulation**: All observations use `provenance = ObservationProvenance.LIVE_API` exclusively upon authentic API response.
- **Truthful Configuration**: `isConfigured()` strictly requires all four server-side secrets (`BRICKLINK_CONSUMER_KEY`, `BRICKLINK_CONSUMER_SECRET`, `BRICKLINK_TOKEN_VALUE`, `BRICKLINK_TOKEN_SECRET`). If any secret is missing, it returns `NOT_CONFIGURED` without network calls.
- **Valuation Eligibility Separation**:
  - `SOLD` observations (`guide_type=sold`) map to `PriceType.SOLD_PRICE` and enter the completed-sales comparable pool for recommendation calculations.
  - `STOCK` observations (`guide_type=stock`) map to `PriceType.ASKING_PRICE` (`ACTIVE_LISTING`) and are preserved as informational market context, strictly excluded from the valuation median and completed-sale count requirements.
- **Truthful Seller & URLs**:
  - Seller is set to `null` (the Price Guide API does not return seller identities; fake names like "BrickLink Verified Order" are eliminated).
  - External URLs link to canonical catalog price guides with deterministic fragment hashes (`...#sale=<fingerprint>`) and record `urlGranularity = "CATALOG_PRICE_GUIDE"` in metadata.
- **Ex-VAT Semantics**:
  - Preserved explicitly as `vatIncluded: false` and `priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE"`.
- **Deduplication on Repeated Refresh**:
  - Deterministic SHA-256 fingerprint generated from `(itemType, itemNo, guideType, condition, unitPrice, quantity, dateOrdered, sellerCountry, buyerCountry)`.
  - Persisted in `externalListingId` and checked on snapshot insertion, allowing all distinct historical transactions to be saved while completely preventing duplicates on subsequent 6-hour sweeps.

---

## 2. Automated Test Coverage & Verification

| Test Suite | Focus / Scenarios | Result |
| :--- | :--- | :--- |
| [`tests/bricklink_oauth.test.ts`](../tests/bricklink_oauth.test.ts) | RFC 3986 percent encoding, parameter normalization, deterministic HMAC-SHA1 signatures, RFC 5849 test vectors | **6 / 6 Passed** |
| [`tests/bricklink_provider.test.ts`](../tests/bricklink_provider.test.ts) | Identifier mapping (`10316-1` vs `35106`), strict price parser, 4-secret truthfulness, fingerprinting, SOLD vs STOCK parsing, ex-VAT metadata, HTTP 401 handling | **16 / 16 Passed** |
| [`tests/bricklink_live.test.ts`](../tests/bricklink_live.test.ts) | Live external test harness (`npm run test:live:bricklink`). Correctly reports SKIPPED / NOT_CONFIGURED when secrets are missing | **1 / 1 Passed (Skipped cleanly)** |
| Full Automated Suite (23 files) | Accounting, auth, completed sales valuation, financials, inventory, pricing, Shopify, worker | **176 passed, 2 skipped, 0 failed** |

---

## 3. Production Deployment & Live Status

- **Commit Sequence**:
  1. `7796b66`: `fix(bricklink): remove incomplete fake oauth implementation`
  2. `930b1e3`: `feat(bricklink): add official oauth1 api client`
  3. `f26ef76`: `feat(bricklink): implement catalog and price guide client`
  4. `9555f45`: `feat(bricklink): integrate sold and stock evidence provider`
  5. `d4093b9`: `fix(bricklink): add stable historical observation deduplication`
  6. `f35e127`: `test(bricklink): add unit and integration coverage`
  7. `43ecac0`: `test(bricklink): add live official api acceptance test`
  8. `88759c4`: `feat(ui): expose truthful BrickLink price guide evidence`
- **GitHub Actions CI Run**: [#36329543431](https://github.com/kabirwadhwa/lego-command-center/actions/runs/36329543431) (**SUCCESS**)
- **Railway Production Service**: `lego-command-center` (**Online**)

---

## 4. Phase 2 Scope (Future Milestone)

The official BrickLink Store API also supports store management operations:
- Order retrieval & status updates (`/orders`, `/orders/{order_id}`)
- Inventory synchronization & creation (`/inventories`)
- Inbound inventory alerts & notifications

These store inventory operations are scheduled for **Phase 2**. This milestone completes **Market Pricing Intelligence**.
