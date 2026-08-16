# LEGO Command Center

LEGO Command Center is a production-ready, high-volume web application designed for professional LEGO resellers. It serves as the single source of truth and command hub for managing inventory, accounting splits, marketplace listings, offline sales, purchases, and real-time market pricing recommendations.

---

## 1. Product Purpose
The application replaces fragmented reseller workflows (Shopify, Bol.com, spreadsheets, manual stock tracking, and price checking) by consolidating operations into one interface. Key capabilities include:
- **Inventory Ledgering**: Double-entry inventory ledger logging all intakes, sales, transfers, and corrections.
- **Stock Ownership Division**: Separation of Company stock (Vervliet Enterprises) and Personal stock (Stock X).
- **Marketplace Synchronization**: Real-time listing tracking and automated inventory updates across Shopify, Bol.com, and Catawiki.
- **Pricing Engine**: Deterministic market-aware recommendations comparing store prices with BrickLink, eBay, Bol, Shopify, and Catawiki.
- **Security Audit Trail**: Immutable log recording all operations, actor profiles, and database events.

---

## 2. Architecture Overview
The application follows a clean service-oriented layout:
- **Presentation Layer**: Next.js App Router with React Client and Server Components styled using Vanilla CSS tokens.
- **Domain Services**: Centralized ledger, inventory, pricing, and sync operations services located in `src/services/` and client actions in `src/app/actions/`.
- **Data Access Layer**: Prisma 7 ORM mapping models to a PostgreSQL database using pg driver adapters.
- **Integration Framework**: Event-driven webhook processing and background sync jobs supporting both `DEMO` and `REAL` modes.

---

## 3. Tech Stack
- **Framework**: Next.js 16 (App Router, Server Actions, React 19)
- **Database**: PostgreSQL (Prisma 7 ORM)
- **Authentication**: Supabase Auth (with automatic database profile provisioning)
- **Testing**: Jest (`ts-jest` for TypeScript compilation)
- **Linter/Formatter**: ESLint (Next.js default rules)

---

## 4. Local Setup
### Dependencies
Ensure you have Node.js 22+ and PostgreSQL installed locally.

1. Clone the repository and install packages:
   ```bash
   npm install
   ```

2. Create a local PostgreSQL database:
   ```sql
   CREATE DATABASE lego_command_center;
   CREATE DATABASE lego_command_center_test;
   ```

3. Set up the `.env` variables (see below).

---

## 5. Environment Variables
Create a `.env` file in the root directory:
```bash
# Database Connections
DATABASE_URL="postgresql://username:password@localhost:5432/lego_command_center"
TEST_DATABASE_URL="postgresql://username:password@localhost:5432/lego_command_center_test"

# Supabase Credentials (For REAL mode Auth)
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"

# Integration Mode (DEMO or REAL)
NEXT_PUBLIC_INTEGRATION_MODE="DEMO"
```

---

## 6. Supabase Setup & Provisioning
When a user registers or logs in via Supabase Auth, they are assigned a Supabase UUID.
- **Alignment**: The application `User.id` strictly aligns with the Supabase Auth user UUID.
- **Provisioning**: During authentication requests, `getCurrentUser()` automatically checks if a database user profile exists for the authenticated session UUID. If missing, it provisions a new database profile (defaulting to a `VIEWER` role).

---

## 7. PostgreSQL & Prisma Migrations
To push the database schema and initialize structures:
```bash
# Synchronize schema structures directly
npx prisma db push

# Generate Prisma client types
npx prisma generate
```

---

## 8. Seed / Demo Data
Initialize development profiles, mockup LEGO sets, inventory accounts, listings, and logs:
```bash
npx prisma db seed
```
Demo accounts:
- **Kristof Vervliet** (Admin): `kristof@vervliet.be` (UUID: `44444444-4444-4444-4444-444444444444`)
- **Sabine Vervliet** (Family Seller): `wife@vervliet.be` (UUID: `55555555-5555-5555-5555-555555555555`)
- **Family Assistant** (Viewer): `viewer@vervliet.be` (UUID: `66666666-6666-6666-6666-666666666666`)

---

## 9. Test Commands
Run the Jest automated test suite verifying ledger invariants, idempotency, and concurrency:
```bash
npm run test
```

---

## 10. Inventory & Stock Models
- **Double-Entry Ledger**: Every stock change is written as an immutable `InventoryTransaction` record. Editing or deleting historical transactions is forbidden.
- **Accounts Split**:
  - `Vervliet Enterprises` (Type: `COMPANY`): Holds wholesale assets.
  - `Stock X` (Type: `PERSONAL`): Private stock holding.
- **Moving Average Cost**: Balances track weighted average cost basis (`InventoryBalance.averageCost`) using fixed-precision Decimal types.

---

## 11. CSV Ingestion
- **Route**: `/inventory/import`
- Parses standard text CSVs entirely on the client, validates structures, flags duplicate rows/SKUs in the sheet, and commits items inside single isolated database transactions.

---

## 12. Marketplace Integration Framework
All marketplace integrations implement a common interface layout:
- **Shopify / Bol.com / Catawiki**: Unified adapter routines for syncing inventory, retrieving listings, downloading orders, and listening to events.
- **Modes**:
  - `DEMO` mode: Simulates mock API callbacks, order ingestion, and inventory decrements.
  - `REAL` mode: Queries live REST/GraphQL APIs and authenticates payload webhooks.

---

## 13. Deployment
- Compiles via Next.js server builds:
  ```bash
  npm run build
  ```
- Can be deployed on Vercel, Docker containers, or Node hosts. Make sure `DATABASE_URL` and Supabase variables are set up in the production environment.

---

## 14. Known Limitations
- Modifying historical transaction entries is locked. Any corrections require creating a correcting ledger transaction.
- External webhook calls require a public URL endpoint (configured in Supabase/Shopify dashboards) to receive live payload events in REAL mode.
