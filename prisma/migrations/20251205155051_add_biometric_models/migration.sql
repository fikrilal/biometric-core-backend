-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "aaguid" TEXT,
    "transports" TEXT,
    "deviceName" TEXT,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedReason" TEXT,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Credential_credentialId_key" ON "Credential"("credentialId");

-- CreateIndex
CREATE INDEX "Credential_userId_idx" ON "Credential"("userId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "Device_credentialId_idx" ON "Device"("credentialId");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
