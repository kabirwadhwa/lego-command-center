import "dotenv/config";
import { PrismaClient, UserRole, InventoryAccountType, InventoryTransactionType, MarketplaceType, ListingStatus, PriceType, SyncStatus, SaleStatus, PurchaseStatus, AlertSeverity, AlertType, ProductCondition, VariantStatus, ActorType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding databases with demo data...");

  // 1. Clean existing database records
  await prisma.auditLog.deleteMany({});
  await prisma.alert.deleteMany({});
  await prisma.syncJob.deleteMany({});
  await prisma.priceRecommendation.deleteMany({});
  await prisma.marketPriceSnapshot.deleteMany({});
  await prisma.marketplaceListing.deleteMany({});
  await prisma.marketplace.deleteMany({});
  await prisma.marketplaceEvent.deleteMany({});
  await prisma.purchaseItem.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.saleItem.deleteMany({});
  await prisma.sale.deleteMany({});
  await prisma.inventoryTransaction.deleteMany({});
  await prisma.inventoryBalance.deleteMany({});
  await prisma.inventoryAccount.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.user.deleteMany({});

  // 2. Seed Users
  console.log("Seeding Users...");
  const adminUser = await prisma.user.create({
    data: {
      id: "44444444-4444-4444-4444-444444444444", // Simulating fixed UUID aligned with auth
      email: "kristof@vervliet.be",
      name: "Kristof Vervliet",
      role: UserRole.ADMIN,
      status: "ACTIVE",
    },
  });

  await prisma.user.create({
    data: {
      id: "55555555-5555-5555-5555-555555555555",
      email: "wife@vervliet.be",
      name: "Sabine Vervliet",
      role: UserRole.FAMILY_SELLER,
      status: "ACTIVE",
    },
  });

  await prisma.user.create({
    data: {
      id: "66666666-6666-6666-6666-666666666666",
      email: "viewer@vervliet.be",
      name: "Family Assistant",
      role: UserRole.VIEWER,
      status: "ACTIVE",
    },
  });

  // 3. Seed Inventory Accounts
  console.log("Seeding Inventory Accounts...");
  const companyAccount = await prisma.inventoryAccount.create({
    data: {
      name: "Vervliet Enterprises",
      type: InventoryAccountType.COMPANY,
      status: "ACTIVE",
    },
  });

  const personalAccount = await prisma.inventoryAccount.create({
    data: {
      name: "Stock X",
      type: InventoryAccountType.PERSONAL,
      status: "ACTIVE",
    },
  });

  // 4. Seed Marketplaces
  console.log("Seeding Marketplaces...");
  await prisma.marketplace.createMany({
    data: [
      {
        id: MarketplaceType.SHOPIFY,
        name: "Shopify Store",
        status: "CONNECTED",
        mode: "DEMO",
        supportsOrders: true,
        supportsInventorySync: true,
        supportsPriceFeed: false,
        supportsAuctions: false,
        supportsWebhooks: true,
      },
      {
        id: MarketplaceType.BOL,
        name: "Bol.com Plaza",
        status: "CONNECTED",
        mode: "DEMO",
        supportsOrders: true,
        supportsInventorySync: true,
        supportsPriceFeed: false,
        supportsAuctions: false,
        supportsWebhooks: true,
      },
      {
        id: MarketplaceType.CATAWIKI,
        name: "Catawiki Auctions",
        status: "CONNECTED",
        mode: "DEMO",
        supportsOrders: true,
        supportsInventorySync: false,
        supportsPriceFeed: false,
        supportsAuctions: true,
        supportsWebhooks: false,
      },
    ],
  });

interface DemoVariant {
  sku: string;
  condition: ProductCondition;
  location: string;
  cost: number;
  companyQty: number;
  personalQty: number;
  hasSyncError?: boolean;
  hasPricingOp?: boolean;
}

  // 5. Seed Products and Variants
  console.log("Seeding Products and Variants...");
  const productsData: {
    setNumber: string;
    name: string;
    theme: string;
    ean: string;
    variants: DemoVariant[];
  }[] = [
    {
      setNumber: "10316",
      name: "The Lord of the Rings: Rivendell",
      theme: "Icons",
      ean: "5702017416885",
      variants: [
        { sku: "LGO-10316-NEW", condition: ProductCondition.NEW_SEALED, location: "A-12", cost: 350.00, companyQty: 8, personalQty: 0 },
        { sku: "LGO-10316-BOX", condition: ProductCondition.DAMAGED_BOX, location: "A-13", cost: 320.00, companyQty: 0, personalQty: 3 },
      ],
    },
    {
      setNumber: "75192",
      name: "Star Wars: UCS Millennium Falcon",
      theme: "Star Wars",
      ean: "5702015869936",
      variants: [
        { sku: "LGO-75192-NEW", condition: ProductCondition.NEW_SEALED, location: "B-01", cost: 620.00, companyQty: 4, personalQty: 2 },
      ],
    },
    {
      setNumber: "75313",
      name: "Star Wars: UCS AT-AT",
      theme: "Star Wars",
      ean: "5702016913965",
      variants: [
        { sku: "LGO-75313-NEW", condition: ProductCondition.NEW_SEALED, location: "B-02", cost: 650.00, companyQty: 2, personalQty: 0, hasSyncError: true },
      ],
    },
    {
      setNumber: "10294",
      name: "LEGO Titanic",
      theme: "Icons",
      ean: "5702016913781",
      variants: [
        { sku: "LGO-10294-NEW", condition: ProductCondition.NEW_SEALED, location: "C-05", cost: 500.00, companyQty: 5, personalQty: 1 },
      ],
    },
    {
      setNumber: "10305",
      name: "Lion Knights' Castle",
      theme: "Castle / Icons",
      ean: "5702017156682",
      variants: [
        { sku: "LGO-10305-NEW", condition: ProductCondition.NEW_SEALED, location: "A-01", cost: 280.00, companyQty: 6, personalQty: 0, hasPricingOp: true },
      ],
    },
    {
      setNumber: "10295",
      name: "Porsche 911",
      theme: "Icons",
      ean: "5702016913484",
      variants: [
        { sku: "LGO-10295-NEW", condition: ProductCondition.NEW_SEALED, location: "D-03", cost: 110.00, companyQty: 0, personalQty: 3 },
      ],
    },
    {
      setNumber: "21322",
      name: "Pirates of Barracuda Bay",
      theme: "Ideas",
      ean: "5702016616088",
      variants: [
        { sku: "LGO-21322-NEW", condition: ProductCondition.NEW_SEALED, location: "D-08", cost: 190.00, companyQty: 0, personalQty: 0 }, // Out of stock
      ],
    },
    {
      setNumber: "42146",
      name: "Technic Liebherr Crawler Crane LR 13000",
      theme: "Technic",
      ean: "5702016912951",
      variants: [
        { sku: "LGO-42146-NEW", condition: ProductCondition.NEW_SEALED, location: "Technic-1", cost: 480.00, companyQty: 4, personalQty: 1 },
      ],
    },
    {
      setNumber: "71043",
      name: "Hogwarts Castle",
      theme: "Harry Potter",
      ean: "5702016110319",
      variants: [
        { sku: "LGO-71043-NEW", condition: ProductCondition.NEW_SEALED, location: "C-01", cost: 310.00, companyQty: 3, personalQty: 1 },
        { sku: "LGO-71043-USED", condition: ProductCondition.USED_COMPLETE, location: "C-02", cost: 200.00, companyQty: 1, personalQty: 0 },
      ],
    },
    {
      setNumber: "10300",
      name: "Back to the Future Time Machine",
      theme: "Icons",
      ean: "5702017151830",
      variants: [
        { sku: "LGO-10300-NEW", condition: ProductCondition.NEW_SEALED, location: "D-14", cost: 130.00, companyQty: 12, personalQty: 5 },
      ],
    },
    {
      setNumber: "21330",
      name: "Home Alone",
      theme: "Ideas",
      ean: "5702017053301",
      variants: [
        { sku: "LGO-21330-NEW", condition: ProductCondition.NEW_SEALED, location: "E-01", cost: 180.00, companyQty: 3, personalQty: 0 },
      ],
    },
    {
      setNumber: "21333",
      name: "The Starry Night",
      theme: "Ideas",
      ean: "5702017189970",
      variants: [
        { sku: "LGO-21333-NEW", condition: ProductCondition.NEW_SEALED, location: "E-02", cost: 120.00, companyQty: 7, personalQty: 2 },
      ],
    },
  ];

  let totalProducts = 0;
  let totalVariants = 0;

  for (const prodData of productsData) {
    const product = await prisma.product.create({
      data: {
        setNumber: prodData.setNumber,
        name: prodData.name,
        theme: prodData.theme,
        ean: prodData.ean,
        status: "ACTIVE",
      },
    });
    totalProducts++;

    for (const varData of prodData.variants) {
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: varData.sku,
          condition: varData.condition,
          storageLocation: varData.location,
          notes: `Initial stock for ${product.name}`,
          status: VariantStatus.ACTIVE,
        },
      });
      totalVariants++;

      // Seed Balances & Transactions if stock exists
      if (varData.companyQty > 0) {
        await prisma.inventoryBalance.create({
          data: {
            productVariantId: variant.id,
            inventoryAccountId: companyAccount.id,
            quantity: varData.companyQty,
            averageCost: varData.cost,
          },
        });

        await prisma.inventoryTransaction.create({
          data: {
            productVariantId: variant.id,
            inventoryAccountId: companyAccount.id,
            type: InventoryTransactionType.PURCHASE,
            quantity: varData.companyQty,
            unitCost: varData.cost,
            actorType: ActorType.USER,
            actorId: adminUser.id,
            actorName: adminUser.name,
            notes: "Seed purchase intake for Vervliet Enterprises",
          },
        });
      }

      if (varData.personalQty > 0) {
        await prisma.inventoryBalance.create({
          data: {
            productVariantId: variant.id,
            inventoryAccountId: personalAccount.id,
            quantity: varData.personalQty,
            averageCost: varData.cost,
          },
        });

        await prisma.inventoryTransaction.create({
          data: {
            productVariantId: variant.id,
            inventoryAccountId: personalAccount.id,
            type: InventoryTransactionType.PURCHASE,
            quantity: varData.personalQty,
            unitCost: varData.cost,
            actorType: ActorType.USER,
            actorId: adminUser.id,
            actorName: adminUser.name,
            notes: "Seed purchase intake for Stock X (Personal)",
          },
        });
      }

      // Seed Listings
      let listingPrice = varData.cost * 1.35; // default markup
      if (varData.hasPricingOp) {
        listingPrice = varData.cost * 1.15; // lower pricing for pricing op
      }

      if (varData.companyQty > 0) {
        await prisma.marketplaceListing.create({
          data: {
            productVariantId: variant.id,
            marketplace: MarketplaceType.SHOPIFY,
            externalListingId: `shopify-lst-${varData.sku}`,
            status: ListingStatus.ACTIVE,
            price: listingPrice,
            quantity: varData.companyQty,
          },
        });

        await prisma.marketplaceListing.create({
          data: {
            productVariantId: variant.id,
            marketplace: MarketplaceType.BOL,
            externalListingId: `bol-lst-${varData.sku}`,
            status: ListingStatus.ACTIVE,
            price: listingPrice + 10.00, // Bol price slightly higher due to commission
            quantity: varData.companyQty,
          },
        });
      }

      // Seed market price snapshots (competitors)
      const retailPrice = varData.cost * 1.4;
      await prisma.marketPriceSnapshot.createMany({
        data: [
          {
            productId: product.id,
            marketplace: "competitor_shop_a",
            price: retailPrice - 5.00,
            priceType: PriceType.ASKING_PRICE,
            seller: "BrickStore Belgium",
            shipping: 6.95,
            availability: true,
          },
          {
            productId: product.id,
            marketplace: "ebay_completed",
            price: retailPrice * 0.9,
            priceType: PriceType.SOLD_PRICE,
            seller: "ebay-power-seller",
            shipping: 10.00,
            availability: true,
          },
        ],
      });

      // Special case: Catawiki auctions
      if (product.setNumber === "10316" || product.setNumber === "75192") {
        await prisma.marketPriceSnapshot.create({
          data: {
            productId: product.id,
            marketplace: "catawiki_live",
            price: retailPrice * 0.75, // spec current bid
            priceType: PriceType.CURRENT_BID,
            seller: "Catawiki Auction",
            shipping: 15.00,
            auctionEndAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // ends in 2 days
          },
        });

        await prisma.marketPriceSnapshot.create({
          data: {
            productId: product.id,
            marketplace: "catawiki_past",
            price: retailPrice * 0.85,
            priceType: PriceType.SOLD_PRICE,
            seller: "Catawiki Sold",
            shipping: 15.00,
          },
        });
      }

      // pricing recommendations
      if (varData.companyQty > 0) {
        const lowestCompetitor = retailPrice - 5.00;
        const suggested = lowestCompetitor - 1.00;
        const estimatedMargin = ((suggested - varData.cost) / suggested) * 100;
        await prisma.priceRecommendation.create({
          data: {
            productVariantId: variant.id,
            recommendedPrice: suggested,
            reasoning: `Median competitor is €${retailPrice.toFixed(2)}. Lowest shop listing is €${lowestCompetitor.toFixed(2)}. Setting your price to €${suggested.toFixed(2)} places you approximately 0.2% below competitors while retaining a ${estimatedMargin.toFixed(0)}% margin.`,
          },
        });

        // Set variant's default price
        await prisma.productVariant.update({
          where: { id: variant.id },
          data: {
            notes: `Our price updated to €${suggested.toFixed(2)}`,
          },
        });
      }

      // Sync error seed
      if (varData.hasSyncError) {
        await prisma.syncJob.create({
          data: {
            marketplace: MarketplaceType.SHOPIFY,
            operation: "SYNC_INVENTORY",
            productVariantId: variant.id,
            status: SyncStatus.FAILED,
            attemptNumber: 3,
            errorDetails: "Shopify API returned 422: Inventory item is locked by another transaction.",
          },
        });

        await prisma.alert.create({
          data: {
            productVariantId: variant.id,
            type: AlertType.SYNC_ERROR,
            severity: AlertSeverity.CRITICAL,
            message: `Shopify stock synchronization failed for SKU: ${varData.sku}. Error: locked inventory record.`,
          },
        });
      }

      // Pricing opportunity seed
      if (varData.hasPricingOp) {
        await prisma.alert.create({
          data: {
            productVariantId: variant.id,
            type: AlertType.PRICE_OPPORTUNITY,
            severity: AlertSeverity.INFO,
            message: `Pricing opportunity for SKU: ${varData.sku}. You have 6 in stock. Competitors are charging 20% above your cost. Recommended price €395.00 yields 29% margin.`,
          },
        });
      }
    }
  }

  // 6. Seed a few past Sales
  console.log("Seeding Sales...");
  const rivendellVar = await prisma.productVariant.findFirst({
    where: { sku: "LGO-10316-NEW" },
  });

  if (rivendellVar) {
    const sale1 = await prisma.sale.create({
      data: {
        marketplaceId: MarketplaceType.SHOPIFY,
        externalOrderId: "SHP-1001",
        saleDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        status: SaleStatus.COMPLETED,
        grossRevenue: 479.99,
        marketplaceFees: 14.40,
        shippingRevenue: 0.00,
        shippingCost: 7.50,
        discount: 0.00,
        netRevenue: 458.09,
        notes: "Shopify sale sync test",
      },
    });

    await prisma.saleItem.create({
      data: {
        saleId: sale1.id,
        productVariantId: rivendellVar.id,
        inventoryAccountId: companyAccount.id,
        quantity: 1,
        unitSalePrice: 479.99,
        unitCostAtSale: 350.00,
        lineRevenue: 479.99,
      },
    });

    // sale transaction
    await prisma.inventoryTransaction.create({
      data: {
        productVariantId: rivendellVar.id,
        inventoryAccountId: companyAccount.id,
        type: InventoryTransactionType.SALE,
        quantity: -1,
        unitCost: 350.00,
        channel: MarketplaceType.SHOPIFY,
        externalOrderId: "SHP-1001",
        actorType: ActorType.MARKETPLACE,
        actorId: "SHOPIFY",
        actorName: "Shopify Webhook",
        notes: "Sale sync for Shopify order #SHP-1001",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
  }

  // 7. Seed past Purchases
  console.log("Seeding Purchases...");
  const titanicVar = await prisma.productVariant.findFirst({
    where: { sku: "LGO-10294-NEW" },
  });

  if (titanicVar) {
    const purchase1 = await prisma.purchase.create({
      data: {
        supplier: "LEGO Direct wholesale",
        purchaseDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        status: PurchaseStatus.RECEIVED,
        totalCost: 2500.00,
        shippingCost: 50.00,
        importFees: 0.00,
        notes: "Intake wholesale invoice #WH-98213",
      },
    });

    await prisma.purchaseItem.create({
      data: {
        purchaseId: purchase1.id,
        productVariantId: titanicVar.id,
        inventoryAccountId: companyAccount.id,
        quantity: 5,
        unitCost: 500.00,
      },
    });
  }

  // 8. Seed global admin logs
  console.log("Seeding Audit Logs...");
  await prisma.auditLog.createMany({
    data: [
      {
        actorType: ActorType.USER,
        actorId: adminUser.id,
        actorName: adminUser.name,
        action: "INITIAL_DATABASE_SEED",
        details: `Seeded ${totalProducts} products and ${totalVariants} variants into the system database.`,
      },
      {
        actorType: ActorType.USER,
        actorId: adminUser.id,
        actorName: adminUser.name,
        action: "TRANSFER_STOCK",
        details: "Transferred 2 units of LGO-75192-NEW from Stock X to Vervliet Enterprises.",
      },
      {
        actorType: ActorType.SYSTEM,
        actorId: "SYSTEM",
        actorName: "System Scheduler",
        action: "MARKETPLACE_SYNC",
        details: "Shopify inventory levels verified. Sync job completed successfully.",
      },
    ],
  });

  console.log("Database seeded successfully with demo data!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
