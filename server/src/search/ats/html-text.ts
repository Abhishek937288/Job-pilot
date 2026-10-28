import * as cheerio from "cheerio";

/** Greenhouse `content` is entity-escaped HTML ("&lt;h2&gt;..."). Decode, then extract text. */
export function htmlToText(html: string | null | undefined, { escaped = false } = {}): string | null {
  if (!html) return null;
  const source = escaped ? cheerio.load(`<textarea>${html}</textarea>`)("textarea").text() : html;
  const $ = cheerio.load(source);
  $("br").replaceWith("\n");
  $("p, li, h1, h2, h3, h4, h5, h6, div").each((_, el) => {
    $(el).append("\n");
  });
  const text = $.root().text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return text || null;
}
