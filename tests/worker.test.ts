import { prisma, pool } from "@/lib/prisma";
import { MarketplaceType, SyncOperation, SyncStatus, SyncJob } from "@prisma/client";

describe("Worker Concurrency & Atomic Claiming Tests", () => {
  let testJobId: string;

  beforeEach(async () => {
    // 1. Create a dummy pending sync job
    const job = await prisma.syncJob.create({
      data: {
        marketplace: MarketplaceType.SHOPIFY,
        operation: SyncOperation.SYNC_INVENTORY,
        status: SyncStatus.PENDING,
        attemptCount: 0,
        nextAttemptAt: new Date(),
      },
    });
    testJobId = job.id;
  });

  afterEach(async () => {
    // Cleanup
    await prisma.syncJob.deleteMany({
      where: { id: testJobId },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  test("Concurrency verification: Two workers running claiming query concurrently must never claim the same job", async () => {
    const claimQuery = `
      UPDATE "SyncJob"
      SET "status" = 'PROCESSING',
          "lockedAt" = NOW(),
          "lockedBy" = $1,
          "attemptCount" = "attemptCount" + 1,
          "startedAt" = NOW()
      WHERE "id" = (
        SELECT "id"
        FROM "SyncJob"
        WHERE "id" = $2
          AND ("status" = 'PENDING' OR "status" = 'FAILED' OR "status" = 'RETRYING')
          AND "attemptCount" < 5
          AND "nextAttemptAt" <= NOW()
          AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '5 minutes')
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    // Fire two claim operations concurrently
    const [result1, result2] = await Promise.all([
      prisma.$queryRawUnsafe<SyncJob[]>(claimQuery, "worker-thread-A", testJobId),
      prisma.$queryRawUnsafe<SyncJob[]>(claimQuery, "worker-thread-B", testJobId),
    ]);

    // Assertions:
    // Exactly one worker must have successfully claimed the job, while the other receives an empty array.
    const claimedByA = result1.length > 0;
    const claimedByB = result2.length > 0;

    expect(claimedByA !== claimedByB).toBe(true); // One true, one false
    
    if (claimedByA) {
      expect(result1[0].lockedBy).toBe("worker-thread-A");
      expect(result2.length).toBe(0);
    } else {
      expect(result2[0].lockedBy).toBe("worker-thread-B");
      expect(result1.length).toBe(0);
    }

    // Verify the state in the database
    const dbJob = await prisma.syncJob.findUnique({
      where: { id: testJobId },
    });
    expect(dbJob).not.toBeNull();
    expect(dbJob?.status).toBe(SyncStatus.PROCESSING);
    expect(dbJob?.attemptCount).toBe(1);
    expect(["worker-thread-A", "worker-thread-B"]).toContain(dbJob?.lockedBy);
  });
});
