"use client";

import { ATS_PROVIDERS, type AtsCompanyDto, type AtsProvider } from "@jobpilot/shared";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";

const AUTO = "__auto";
const BOARD_URL: Record<AtsProvider, (slug: string) => string> = {
  GREENHOUSE: (s) => `https://job-boards.greenhouse.io/${s}`,
  LEVER: (s) => `https://jobs.lever.co/${s}`,
  ASHBY: (s) => `https://jobs.ashbyhq.com/${s}`,
};

export default function SettingsPage() {
  const [companies, setCompanies] = useState<AtsCompanyDto[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<string>(AUTO);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AtsCompanyDto[]>("/ats-companies").then(setCompanies).catch((err) => setError(errorMessage(err)));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const c = await api<AtsCompanyDto>("/ats-companies", {
        method: "POST",
        body: JSON.stringify({ input, provider: provider === AUTO ? null : provider }),
      });
      setCompanies((cs) => [...cs, c].sort((a, b) => a.provider.localeCompare(b.provider) || a.slug.localeCompare(b.slug)));
      setInput("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function toggle(c: AtsCompanyDto, enabled: boolean) {
    setCompanies((cs) => cs.map((x) => (x.id === c.id ? { ...x, enabled } : x)));
    try {
      await api(`/ats-companies/${c.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    } catch (err) {
      setCompanies((cs) => cs.map((x) => (x.id === c.id ? c : x)));
      setError(errorMessage(err));
    }
  }

  async function remove(c: AtsCompanyDto) {
    setCompanies((cs) => cs.filter((x) => x.id !== c.id));
    try {
      await api(`/ats-companies/${c.id}`, { method: "DELETE" });
    } catch (err) {
      setCompanies((cs) => [...cs, c]);
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Companies whose public job boards are read directly on every search (free, no Serper credits).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company job boards</CardTitle>
          <CardDescription>
            Paste a board URL like <code>boards.greenhouse.io/stripe</code>, <code>jobs.lever.co/acme</code> or <code>jobs.ashbyhq.com/acme</code>, or pick a
            provider and type the slug. The board is checked live before it is saved. Only roles matching your target titles are kept.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Board URL or slug" />
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Detect from URL</SelectItem>
                {ATS_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={adding || !input.trim()}>
              {adding && <Loader2 className="animate-spin" />} Add
            </Button>
          </form>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {companies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No companies yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {companies.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                  <Switch checked={c.enabled} onCheckedChange={(v) => void toggle(c, v)} aria-label={`Enable ${c.slug}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a href={BOARD_URL[c.provider](c.slug)} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                        {c.displayName ?? c.slug}
                      </a>
                      <Badge variant="outline">{c.provider.charAt(0) + c.provider.slice(1).toLowerCase()}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.slug} · {c.lastJobCount ?? "?"} open roles
                      {c.lastFetchedAt && ` · checked ${new Date(c.lastFetchedAt).toLocaleString()}`}
                    </div>
                    {c.lastError && <div className="text-xs text-destructive">Last error: {c.lastError}</div>}
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${c.slug}`} onClick={() => void remove(c)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
