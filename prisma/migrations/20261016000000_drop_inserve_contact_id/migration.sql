-- Verwijder de Inserve-contactkoppeling: contactpersonen worden niet meer
-- vanuit Inserve geïmporteerd. Handmatig contactbeheer blijft bestaan.

-- DropIndex (IF EXISTS: oudere omgevingen kunnen deze indexen via `db push` anders hebben genoemd)
DROP INDEX IF EXISTS "contact_persons_inserveContactId_key";

-- DropIndex
DROP INDEX IF EXISTS "contact_persons_inserveContactId_idx";

-- AlterTable
ALTER TABLE "contact_persons" DROP COLUMN IF EXISTS "inserveContactId";
