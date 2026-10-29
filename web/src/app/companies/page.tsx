"use client";

import type { CompanyDto } from "@jobpilot/shared";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AddCompanyForm } from "@/components/add-company-form";
import { CompaniesTable } from "@/components/companies-table";
import { Alert, Card, EmptyState, PageHeader, PageLoader } from "@/components/ui/feedback";
import { api, errorMessage } from "@/lib/api";
import { useRequireSession } from "@/lib/session";

export default function CompaniesPage() {
  const session = useRequireSession();
  const [companies, setCompanies] = useState<CompanyDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setCompanies(await api<CompanyDto[]>("/companies"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (session.status === "authenticated") void load();
  }, [session.status, load]);

  if (session.status !== "authenticated" || !session.user) return <PageLoader />;
  const isGuest = session.user.isGuest;

  async function refresh(c: CompanyDto) {
    setRefreshing((s) => new Set(s).add(c.id));
    try {
      await api(`/companies/${c.id}/refresh`, { method: "POST" });
      setNotice(`Refresh queued for ${c.name}. Results appear here in a minute.`);
      setTimeout(() => void load(), 8000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing((s) => {
        const n = new Set(s);
        n.delete(c.id);
        return n;
      });
    }
  }

  async function remove(c: CompanyDto) {
    try {
      await api(`/companies/${c.id}`, { method: "DELETE" });
      setCompanies((cs) => cs?.filter((x) => x.id !== c.id) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Company watchlist"
        subtitle="Company job boards checked every few hours. Their jobs are included in everyone's searches."
      />
      <div className="flex flex-col gap-5">
        {isGuest ? (
          <Alert tone="info">
            Guests can view the watchlist but not change it.{" "}
            <Link href="/signup" className="font-semibold underline">
              Sign up
            </Link>{" "}
            to add companies.
          </Alert>
        ) : (
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Add a company</h2>
            <AddCompanyForm
              onAdded={(c) => {
                setCompanies((cs) => [c, ...(cs ?? []).filter((x) => x.id !== c.id)]);
                setNotice(`Added ${c.name} (${c.atsType}). Its jobs are being fetched now.`);
              }}
            />
          </Card>
        )}
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {companies === null ? (
          !error && <PageLoader label="Loading companies…" />
        ) : companies.length === 0 ? (
          <EmptyState icon={<Building2 className="size-8" />} title="The watchlist is empty">
            {isGuest ? "No companies have been added yet." : "Add a company's careers page or ATS board above."}
          </EmptyState>
        ) : (
          <CompaniesTable
            companies={companies}
            readOnly={isGuest}
            refreshing={refreshing}
            onRefresh={refresh}
            onDelete={remove}
          />
        )}
      </div>
    </>
  );
}
