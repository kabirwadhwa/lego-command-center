# Production Readiness Matrix

This document tracks the verification status of all external system integration capabilities inside the LEGO Command Center.

---

## Capabilities Status

| Capability | Integration Platform | Type | Status | E2E Local | Live External | Error Handled | Rate Limits |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **Authentication** | Supabase Auth | AUTH | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Connection Settings** | Shopify API | SYNC | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Catalog Import** | Shopify API | SYNC | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Order Webhooks** | Shopify API | SYNC | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Order Ingestion** | Shopify API | SYNC | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Outbound Inventory Sync** | Shopify API | SYNC | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Outbound Price Sync** | Shopify API | SYNC | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Catawiki Scraper Run** | Apify API | PRICE | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Dataset Observation Parse** | Apify API | PRICE | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Durable Worker Scheduling** | Worker / Cron | WORKER | `REAL_VERIFIED` | Passed | Passed | Yes | Considered |
| **Bol Orders Pull** | Bol.com API | SYNC | `NOT_IMPLEMENTED` | N/A | N/A | N/A | N/A |
| **Bol Inventory Sync** | Bol.com API | SYNC | `NOT_IMPLEMENTED` | N/A | N/A | N/A | N/A |
| **Catawiki Auctions Pull** | Catawiki API | SYNC | `NOT_IMPLEMENTED` | N/A | N/A | N/A | N/A |
| **BrickLink Price Source** | BrickLink API | PRICE | `NOT_IMPLEMENTED` | N/A | N/A | N/A | N/A |
| **eBay Price Source** | eBay API | PRICE | `NOT_IMPLEMENTED` | N/A | N/A | N/A | N/A |

---

## Status Classification Key

- **NOT_IMPLEMENTED**: No code exists. No UI action should trigger this.
- **IMPLEMENTED_UNVERIFIED**: Code is written but has not successfully passed a live external execution test (`LIVE_EXTERNAL`).
- **REAL_VERIFIED**: Code exists, all validation layers pass, and live external tests confirm API contract verification.
- **BLOCKED_EXTERNAL_LIMITATION**: Real integration is blocked due to platform access restrictions.
