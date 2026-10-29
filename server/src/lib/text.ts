import * as cheerio from "cheerio";

/** Lowercase, strip accents and punctuation, collapse whitespace. Used for keys and title matching. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

const COMPANY_SUFFIXES = /\b(incorporated|inc|llc|ltd|limited|pvt|private|plc|gmbh|corp|corporation|co|technologies|technology|labs)\b/g;

export function normalizeCompany(s: string | null | undefined): string {
  return normalizeText(s).replace(COMPANY_SUFFIXES, " ").replace(/\s+/g, " ").trim();
}

/** Plain text from an HTML fragment (scripts and styles removed). Pass `escaped` for entity-escaped HTML. */
export function htmlToText(html: string | null | undefined, opts: { escaped?: boolean } = {}): string | null {
  if (!html) return null;
  let source = html;
  if (opts.escaped) source = cheerio.load(`<div>${html}</div>`)("div").text();
  const $ = cheerio.load(source);
  $("script, style, noscript").remove();
  $("br, p, li, h1, h2, h3, h4, div").each((_, el) => {
    $(el).append("\n");
  });
  const text = $.root().text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return text || null;
}

export function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
