-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RemotePreference" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE', 'ANY');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileData" BYTEA NOT NULL,
    "extractedText" TEXT NOT NULL,
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extractionError" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resumeId" TEXT,
    "name" TEXT,
    "headline" TEXT,
    "totalYearsExperience" DOUBLE PRECISION,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "roles" TEXT[],
    "companies" TEXT[],
    "education" JSONB NOT NULL DEFAULT '[]',
    "projects" JSONB NOT NULL DEFAULT '[]',
    "targetTitles" TEXT[],
    "preferredLocations" TEXT[],
    "remotePreference" "RemotePreference",
    "noticePeriod" TEXT,
    "expectedSalary" TEXT,
    "rawExtraction" JSONB,
    "userEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeVersion" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "jobId" TEXT,
    "label" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "addedKeywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Resume_sha256_key" ON "Resume"("sha256");

-- CreateIndex
CREATE INDEX "Resume_uploadedAt_idx" ON "Resume"("uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_resumeId_key" ON "Profile"("resumeId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_one_active_key" ON "Profile"("isActive") WHERE ("isActive" = true);

-- CreateIndex
CREATE INDEX "ResumeVersion_resumeId_idx" ON "ResumeVersion"("resumeId");

-- CreateIndex
CREATE INDEX "ResumeVersion_jobId_idx" ON "ResumeVersion"("jobId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

