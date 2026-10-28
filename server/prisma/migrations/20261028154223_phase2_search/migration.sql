-- CreateEnum
CREATE TYPE "ApplyMethod" AS ENUM ('EMAIL', 'GREENHOUSE', 'LEVER', 'ASHBY', 'WORKDAY', 'COMPANY_PORTAL', 'LINKEDIN_EASY_APPLY', 'REFERRAL_ONLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RemoteType" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LocationMatch" AS ENUM ('MATCH', 'REMOTE', 'MISMATCH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('SERPER', 'GREENHOUSE', 'LEVER', 'ASHBY');

-- CreateEnum
CREATE TYPE "AtsProvider" AS ENUM ('GREENHOUSE', 'LEVER', 'ASHBY');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NEW', 'DONE', 'IGNORED', 'SAVED');

-- CreateEnum
CREATE TYPE "SearchRunStatus" AS ENUM ('DRAFT', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "locationMatch" "LocationMatch" NOT NULL DEFAULT 'UNKNOWN',
    "remoteType" "RemoteType" NOT NULL DEFAULT 'UNKNOWN',
    "applyMethod" "ApplyMethod" NOT NULL DEFAULT 'UNKNOWN',
    "applyUrl" TEXT,
    "applyEmails" TEXT[],
    "snippet" TEXT,
    "jdText" TEXT,
    "fitScore" INTEGER,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "expired" BOOLEAN NOT NULL DEFAULT false,
    "source" "JobSource" NOT NULL,
    "sourceQuery" TEXT,
    "atsProvider" "AtsProvider",
    "atsSlug" TEXT,
    "atsJobId" TEXT,
    "postedAt" TIMESTAMP(3),
    "raw" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSearchRunId" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobStatus" (
    "jobId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobStatus_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "status" "SearchRunStatus" NOT NULL DEFAULT 'DRAFT',
    "queries" JSONB NOT NULL,
    "queryGenerator" TEXT NOT NULL DEFAULT 'llm',
    "includeAts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "newJobsCount" INTEGER NOT NULL DEFAULT 0,
    "resultsCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateUrlCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "serperCalls" INTEGER NOT NULL DEFAULT 0,
    "serperCredits" INTEGER NOT NULL DEFAULT 0,
    "atsCalls" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "log" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtsCompany" (
    "id" TEXT NOT NULL,
    "provider" "AtsProvider" NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastJobCount" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtsCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_canonicalUrl_key" ON "Job"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Job_fingerprint_idx" ON "Job"("fingerprint");

-- CreateIndex
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

-- CreateIndex
CREATE INDEX "Job_locationMatch_idx" ON "Job"("locationMatch");

-- CreateIndex
CREATE INDEX "JobStatus_status_idx" ON "JobStatus"("status");

-- CreateIndex
CREATE INDEX "SearchRun_status_idx" ON "SearchRun"("status");

-- CreateIndex
CREATE INDEX "SearchRun_createdAt_idx" ON "SearchRun"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AtsCompany_provider_slug_key" ON "AtsCompany"("provider", "slug");

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_firstSearchRunId_fkey" FOREIGN KEY ("firstSearchRunId") REFERENCES "SearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStatus" ADD CONSTRAINT "JobStatus_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
