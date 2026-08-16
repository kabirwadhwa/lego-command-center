# Reality Audit: LEGO Command Center

This document outlines the current state of implementation for various features within the application to provide transparency regarding working production functionality versus simulated/demo behavior.

---

## Capabilities Classification

### 1. Authentication
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/lib/auth.ts`, `src/app/login/page.tsx`
- **Production Network Requests**: Yes, to Supabase Auth endpoints (when configured).
- **Values**: Real when configured; fallbacks to a simulated cookie-based/mock administrator identity in `DEMO` mode or during test runs.
- **Limitations**: In `DEMO` mode, defaults anonymous connections to an administrative profile (`Kristof`) to facilitate onboarding. Decision logic is based on browser-accessible environment variables.

### 2. Inventory Ledger Operations
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/inventoryService.ts`
- **Production Network Requests**: No (operates strictly on local database).
- **Values**: Real.
- **Limitations**: Governs wholesale intake, sales settlements, stock transfers, and manual corrections locally with database row-level locking.

### 3. Company Inventory
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/inventoryService.ts`, `src/app/(dashboard)/inventory/page.tsx`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Tracks inventory balances assigned to accounts with type `COMPANY`.

### 4. Personal Inventory
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/inventoryService.ts`, `src/app/(dashboard)/inventory/page.tsx`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Tracks inventory balances assigned to accounts with type `PERSONAL`.

### 5. Purchases (Wholesale Intake)
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/inventoryService.ts`, `src/app/(dashboard)/purchases/page.tsx`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Records supplier purchases and updates variant cost basis using moving averages.

### 6. Manual Sales
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/inventoryService.ts`, `src/app/(dashboard)/sales/page.tsx`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Records offline invoice transactions and settles margin statistics.

### 7. Transfers
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/inventoryService.ts`, `src/components/TransferModal.tsx`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Double-entry ledger updates between internal warehouses.

### 8. Adjustments
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/inventoryService.ts`, `src/components/AdjustModal.tsx`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Supports manual stock quantity corrections.

### 9. CSV/XLSX Import
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/components/ImportWizard.tsx`, `src/app/actions/inventoryActions.ts`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Processes spreadsheets, extracts set numbers, matches variants, and intakes balances in a single transaction.

### 10. Shopify Connection
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/marketplace/shopify.ts`
- **Production Network Requests**: Yes, in `REAL` mode (requests `GET /admin/api/2023-07/shop.json`).
- **Values**: Real in `REAL` mode, simulated success in `DEMO` mode.
- **Limitations**: Verifies access token connectivity with Shopify API.

### 11. Shopify Product Import
- **Classification**: `DEMO_ONLY`
- **Actual Source File**: `src/services/marketplace/shopify.ts`, `src/components/ShopifyImportWizard.tsx`
- **Production Network Requests**: No.
- **Values**: Mocked (always returns a single mock listing).
- **Limitations**: `REAL` mode throws `NOT_SUPPORTED` for catalog listing retrieval.

### 12. Shopify Webhooks
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/app/api/webhooks/shopify/route.ts`
- **Production Network Requests**: Yes, accepts external POST request hooks.
- **Values**: Real payload data.
- **Limitations**: HMAC-SHA256 signature verification is skipped in DEMO mode if no secret is saved.

### 13. Shopify Order Processing
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/services/marketplace/eventProcessor.ts`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Processes parsed Shopify `orders/create` payload and settles sales locally. Tested locally via mock order payloads in integration tests, but unverified using real Shopify network requests.

### 14. Shopify Outbound Inventory Sync
- **Classification**: `STUB`
- **Actual Source File**: `src/services/marketplace/shopify.ts`, `src/services/marketplace/syncService.ts`
- **Production Network Requests**: No.
- **Values**: Mocked.
- **Limitations**: `REAL` mode throws `NOT_SUPPORTED`.

### 15. Shopify Price Updates
- **Classification**: `STUB`
- **Actual Source File**: `src/services/marketplace/shopify.ts`, `src/services/marketplace/syncService.ts`
- **Production Network Requests**: No.
- **Values**: Mocked.
- **Limitations**: `REAL` mode throws `NOT_SUPPORTED` for price pushes.

### 16. Bol Orders
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: `src/services/marketplace/bol.ts`
- **Production Network Requests**: No.
- **Values**: Mocked in `DEMO` mode, throws `NOT_SUPPORTED` in `REAL` mode.
- **Limitations**: No real API order retrieval implemented.

### 17. Bol Inventory Sync
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: `src/services/marketplace/bol.ts`
- **Production Network Requests**: No.
- **Values**: Mocked in `DEMO` mode, throws `NOT_SUPPORTED` in `REAL` mode.
- **Limitations**: No real API sync implemented.

### 18. Bol Pricing
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: `src/services/marketplace/bol.ts`
- **Production Network Requests**: No.
- **Values**: Mocked in `DEMO` mode, throws `NOT_SUPPORTED` in `REAL` mode.
- **Limitations**: No real competitor price observation retrieval implemented.

### 19. Catawiki Sales
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: `src/services/marketplace/catawiki.ts`
- **Production Network Requests**: No.
- **Values**: Mocked in `DEMO` mode, throws `NOT_SUPPORTED` in `REAL` mode.
- **Limitations**: Auction sales are not pulled via API.

### 20. Catawiki Auctions
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: `src/services/marketplace/catawiki.ts`
- **Production Network Requests**: No.
- **Values**: Mocked in `DEMO` mode, throws `NOT_SUPPORTED` in `REAL` mode.
- **Limitations**: Bid monitoring and auction configurations are mock-only.

### 21. Catawiki Pricing
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: `src/services/marketplace/catawiki.ts`
- **Production Network Requests**: No.
- **Values**: Mocked in `DEMO` mode, throws `NOT_SUPPORTED` in `REAL` mode.
- **Limitations**: Real price snapshots are not retrieved.

### 22. BrickLink Pricing
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: None.
- **Production Network Requests**: No.
- **Values**: Mocked/Seeded only.
- **Limitations**: No adapter exists.

### 23. eBay Pricing
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: None.
- **Production Network Requests**: No.
- **Values**: Mocked/Seeded only.
- **Limitations**: No adapter exists.

### 24. Pricing Collection
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: None.
- **Production Network Requests**: No.
- **Values**: Mocked/Seeded only.
- **Limitations**: No service pulls price data from price source adapters.

### 25. Pricing Recommendation Generation
- **Classification**: `DEMO_ONLY`
- **Actual Source File**: `src/app/(dashboard)/pricing/page.tsx`
- **Production Network Requests**: No.
- **Values**: Seeded data.
- **Limitations**: Suggestions are displayed from the database, but they are generated exclusively by the initial database seed; no live generation engine exists.

### 26. Scheduled Pricing Refresh
- **Classification**: `NOT_IMPLEMENTED`
- **Actual Source File**: None.
- **Production Network Requests**: No.
- **Values**: Simulated.
- **Limitations**: No automated cron or scheduling mechanism refreshes pricing.

### 27. Background Retries
- **Classification**: `STUB`
- **Actual Source File**: `src/services/marketplace/syncService.ts`
- **Production Network Requests**: No.
- **Values**: Simulated.
- **Limitations**: Uses transient `setTimeout` timers instead of a durable queuing system. If server restarts, scheduled retries are lost.

### 28. Alerts
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/app/(dashboard)/alerts/page.tsx`, `src/components/AlertsManager.tsx`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Monitors and displays active system issues.

### 29. Reconciliation
- **Classification**: `DEMO_ONLY`
- **Actual Source File**: `src/app/(dashboard)/marketplaces/shopify/reconciliation/page.tsx`
- **Production Network Requests**: No.
- **Values**: Simulated.
- **Limitations**: Compares db balances against listings, but listing counts are simulated mocks.

### 30. Analytics
- **Classification**: `IMPLEMENTED_UNVERIFIED`
- **Actual Source File**: `src/app/(dashboard)/analytics/page.tsx`
- **Production Network Requests**: No.
- **Values**: Real.
- **Limitations**: Calculates financials and metrics directly from database ledger records.
