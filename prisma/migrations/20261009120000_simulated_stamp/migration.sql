ALTER TYPE "InvoiceStatus" ADD VALUE 'STAMPED_SIMULATED';

ALTER TABLE "Invoice"
ADD COLUMN "simulatedStampId" UUID,
ADD COLUMN "simulatedStampedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Invoice_simulatedStampId_key" ON "Invoice"("simulatedStampId");
