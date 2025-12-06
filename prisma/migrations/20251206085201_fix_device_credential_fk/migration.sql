-- DropForeignKey
ALTER TABLE "Device" DROP CONSTRAINT "Device_credentialId_fkey";

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("credentialId") ON DELETE CASCADE ON UPDATE CASCADE;
