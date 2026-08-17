# Production Readiness Matrix

This document tracks the verification status of all external system integration capabilities inside the LEGO Command Center.

---

## Capabilities Status

| Capability | Integration Platform | Type | Status | E2E Local | Live External | Error Handled | Rate Limits |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **Authentication** | Supabase Auth / Local Cookies | AUTH | `IMPLEMENTED_UNVERIFIED` | N/A | None | Partial | Considered |
| **Connection Settings** | Shopify API | SYNC | `IMPLEMENTED_UNVERIFIED` | N/A | None | Yes | Considered |
| **Catalog Onboarding** | Shopify API (onboarding view) | SYNC | `IMPLEMENTED_UNVERIFIED` | N/A | None | Yes | Considered |
| **Order Webhooks** | Shopify API | SYNC | `IMPLEMENTED_UNVERIFIED` | N/A | None | Yes | Considered |
| **Order Ingestion** | Shopify API | SYNC | IMPLEMENTED_UNVERIFIED | Passed | None | Yes | Considered |
| **Outbound Inventory Sync** | Shopify API | SYNC | `IMPLEMENTED_UNVERIFIED` | N/A | None | Yes | Considered |
| **Outbound Price Sync** | Shopify API | SYNC | `IMPLEMENTED_UNVERIFIED` | N/A | None | Yes | Considered |
| **Catawiki Scraper Run** | Apify API | PRICE | `NOT_IMPLEMENTED` | N/A | None | No | No |
| **Dataset Observation Parse** | Apify API | PRICE | `NOT_IMPLEMENTED` | N/A | None | No | No |
| **Durable Worker Scheduling** | Worker / Cron | WORKER | `WORKING_REAL` | Passed | None | Yes | Considered |
| **Bol Orders Pull** | Bol.com API | SYNC | `NOT_IMPLEMENTED` | N/A | None | No | No |
| **Bol Inventory Sync** | Bol.com API | SYNC | `NOT_IMPLEMENTED` | N/A | None | No | No |
| **Catawiki Auctions Pull** | Catawiki API | SYNC | `NOT_IMPLEMENTED` | N/A | None | No | No |
| **BrickLink Price Source** | BrickLink API | PRICE | `NOT_IMPLEMENTED` | N/A | None | No | No |
| **eBay Price Source** | eBay API | PRICE | `NOT_IMPLEMENTED` | N/A | None | No | No |

---

## Detailed Evidence of Current Capabilities

### 1. Authentication
- **Status**: `IMPLEMENTED_UNVERIFIED`
- **Implementation Evidence**: [`src/lib/auth.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/src/lib/auth.ts). Falls back to the admin user `Kristof`'s seed UUID when no session cookie is set in `DEMO` mode. Supabase auth configured but unverified in production environment.
- **Test Evidence**: [`tests/auth.test.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/tests/auth.test.ts)
- **Live Evidence**: None. No automated production testing has occurred.
- **Last Verified Commit**: None

### 2. Shopify Connection Settings
- **Status**: `IMPLEMENTED_UNVERIFIED`
- **Implementation Evidence**: `testConnection` in [`src/services/marketplace/shopify.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/src/services/marketplace/shopify.ts) executes GraphQL query to `POST /admin/api/2026-07/graphql.json`.
- **Test Evidence**: Connection test cases in [`tests/shopify_live.test.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/tests/shopify_live.test.ts) (skipped when credentials are absent).
- **Live Evidence**: None. No production connection verification has occurred.
- **Last Verified Commit**: None

### 3. Shopify Order Webhook Ingestion
- **Status**: `IMPLEMENTED_UNVERIFIED`
- **Implementation Evidence**: Webhook route handler at [`src/app/api/webhooks/shopify/route.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/src/app/api/webhooks/shopify/route.ts) computes HMAC signature.
- **Test Evidence**: Integration tests in [`tests/shopify.test.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/tests/shopify.test.ts) (HMAC verification and idempotency logic).
- **Live Evidence**: None. No webhooks have been received or verified from a live Shopify store.
- **Last Verified Commit**: None

### 4. Shopify Order Ingestion
- **Status**: `IMPLEMENTED_UNVERIFIED`
- **Implementation Evidence**: [`src/services/marketplace/eventProcessor.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/src/services/marketplace/eventProcessor.ts) parses order lines and decrements stock under row-level locks.
- **Test Evidence**: Integration tests in [`tests/shopify.test.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/tests/shopify.test.ts).
- **Live Evidence**: None. No real webhooks have been processed from a live Shopify store.
- **Last Verified Commit**: None

### 5. Shopify Outbound Inventory Sync
- **Status**: `IMPLEMENTED_UNVERIFIED`
- **Implementation Evidence**: `syncInventory()` in [`src/services/marketplace/shopify.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/src/services/marketplace/shopify.ts) executes GraphQL `inventorySetQuantities` mutation using compare-and-swap logic.
- **Test Evidence**: Unit/integration tests in [`tests/shopify_graphql.test.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/tests/shopify_graphql.test.ts) covering parsing, compare-and-swap, and idempotency keying.
- **Live Evidence**: None. No live store inventory pushes have been verified yet.
- **Last Verified Commit**: None

### 6. Shopify Outbound Price Sync
- **Status**: `IMPLEMENTED_UNVERIFIED`
- **Implementation Evidence**: `updatePrice()` in [`src/services/marketplace/shopify.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/src/services/marketplace/shopify.ts) updates price dynamically via `productVariantUpdate` GraphQL mutation.
- **Test Evidence**: None.
- **Live Evidence**: None. No live store price pushes have been verified yet.
- **Last Verified Commit**: None

### 7. Catawiki Price Collection via Apify Scraper
- **Status**: `NOT_IMPLEMENTED`
- **Implementation Evidence**: No Apify price source adapters, schema definitions, or pricing collection handlers exist in the repository.
- **Live Evidence**: None.
- **Last Verified Commit**: None

### 8. Durable Worker Scheduling
- **Status**: `WORKING_REAL`
- **Implementation Evidence**: Background job daemon running via `src/worker.ts` executing atomic claiming through raw SQL `FOR UPDATE SKIP LOCKED`.
- **Test Evidence**: Concurrency test suite in [`tests/worker.test.ts`](file:///Users/kabirwadhwa/.gemini/antigravity/scratch/lego-command-center/tests/worker.test.ts) proving skip-locked isolation.
- **Live Evidence**: Verified locally during test runs.
- **Last Verified Commit**: None
