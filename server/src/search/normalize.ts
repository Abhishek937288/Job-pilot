/** Text normalization shared by fingerprinting, title matching and location matching. */

export function basicNormalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bnext\.?js\b/g, "nextjs")
    .replace(/\bnode\.?js\b/g, "nodejs")
    .replace(/\breact\.?js\b/g, "react")
    .replace(/\bvue\.?js\b/g, "vue")
    .replace(/\bc\+\+/g, "cpp")
    .replace(/\bc#/g, "csharp")
    .replace(/\.net\b/g, "dotnet")
    .replace(/\bback[\s-]+end\b/g, "backend")
    .replace(/\bfront[\s-]+end\b/g, "frontend")
    .replace(/\bfull[\s-]+stack\b/g, "fullstack")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const TITLE_SYNONYMS: Record<string, string> = {
  sr: "senior",
  snr: "senior",
  jr: "junior",
  jnr: "junior",
  mgr: "manager",
  eng: "engineer",
  engg: "engineer",
  dev: "developer",
};

export function normalizeTitle(title: string): string {
  return basicNormalize(title)
    .split(" ")
    .map((t) => TITLE_SYNONYMS[t] ?? t)
    .join(" ");
}

const COMPANY_SUFFIXES = new Set(["inc", "incorporated", "llc", "llp", "ltd", "limited", "pvt", "private", "corp", "corporation", "co", "gmbh", "plc", "pte", "sa", "ag", "bv"]);

/** "PhonePe Pvt. Ltd." -> "phonepe". Spaces are removed so "Phone Pe" and an ATS slug "phonepe" agree. */
export function normalizeCompany(company: string): string {
  const tokens = basicNormalize(company).split(" ").filter(Boolean);
  while (tokens.length > 1 && COMPANY_SUFFIXES.has(tokens[tokens.length - 1] ?? "")) tokens.pop();
  return tokens.join("");
}
