/**
 * Skill alias map: every variant on the right normalizes to the canonical name on the left
 * ("nodejs", "node" and "Node.js" are all "node.js"). Unknown skills are kept, lowercased.
 */
const ALIASES: Record<string, string[]> = {
  javascript: ["js", "javascript", "ecmascript", "es6"],
  typescript: ["ts", "typescript"],
  "node.js": ["node", "nodejs", "node.js", "node js"],
  react: ["react", "reactjs", "react.js", "react js"],
  "react native": ["react native", "react-native"],
  "next.js": ["next", "nextjs", "next.js"],
  "vue.js": ["vue", "vuejs", "vue.js"],
  angular: ["angular", "angularjs", "angular.js"],
  "express.js": ["express", "expressjs", "express.js"],
  python: ["python", "python3"],
  django: ["django"],
  flask: ["flask"],
  fastapi: ["fastapi"],
  java: ["java"],
  "spring boot": ["spring", "spring boot", "springboot"],
  golang: ["go", "golang"],
  "c++": ["c++", "cpp"],
  "c#": ["c#", "csharp", "c sharp"],
  ".net": [".net", "dotnet", "asp.net", ".net core"],
  ruby: ["ruby"],
  rails: ["rails", "ruby on rails", "ror"],
  php: ["php"],
  kotlin: ["kotlin"],
  swift: ["swift"],
  rust: ["rust"],
  sql: ["sql"],
  postgresql: ["postgres", "postgresql", "psql"],
  mysql: ["mysql"],
  mongodb: ["mongo", "mongodb"],
  redis: ["redis"],
  elasticsearch: ["elasticsearch", "elastic search", "opensearch"],
  kafka: ["kafka", "apache kafka"],
  graphql: ["graphql"],
  "rest api": ["rest", "rest api", "restful", "rest apis", "restful apis"],
  aws: ["aws", "amazon web services"],
  gcp: ["gcp", "google cloud", "google cloud platform"],
  azure: ["azure", "microsoft azure"],
  docker: ["docker"],
  kubernetes: ["kubernetes", "k8s"],
  terraform: ["terraform"],
  "ci/cd": ["ci/cd", "cicd", "ci cd", "continuous integration"],
  git: ["git"],
  linux: ["linux"],
  html: ["html", "html5"],
  css: ["css", "css3"],
  tailwind: ["tailwind", "tailwindcss", "tailwind css"],
  "machine learning": ["machine learning", "ml"],
  "deep learning": ["deep learning", "dl"],
  nlp: ["nlp", "natural language processing"],
  llm: ["llm", "llms", "large language models"],
  pytorch: ["pytorch", "torch"],
  tensorflow: ["tensorflow", "tf"],
  pandas: ["pandas"],
  spark: ["spark", "apache spark", "pyspark"],
  "data analysis": ["data analysis", "data analytics"],
  excel: ["excel", "ms excel", "microsoft excel"],
  tableau: ["tableau"],
  "power bi": ["power bi", "powerbi"],
  figma: ["figma"],
  jira: ["jira"],
  agile: ["agile", "scrum"],
};

const VARIANT_TO_CANONICAL = new Map<string, string>();
for (const [canonical, variants] of Object.entries(ALIASES)) {
  VARIANT_TO_CANONICAL.set(canonical, canonical);
  for (const v of variants) VARIANT_TO_CANONICAL.set(v, canonical);
}

const clean = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function normalizeSkill(skill: string): string {
  const s = clean(skill);
  return VARIANT_TO_CANONICAL.get(s) ?? VARIANT_TO_CANONICAL.get(s.replace(/\s*\(.*\)$/, "")) ?? s;
}

export function normalizeSkills(skills: string[]): string[] {
  return [...new Set(skills.map(normalizeSkill).filter((s) => s.length > 0 && s.length <= 60))];
}

function variantsOf(canonical: string): string[] {
  return ALIASES[canonical] ?? [canonical];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const regexCache = new Map<string, RegExp>();

/** Word-boundary matcher that also works for names with symbols (c++, c#, .net, node.js). */
function skillRegex(canonical: string): RegExp {
  let re = regexCache.get(canonical);
  if (!re) {
    const alternatives = variantsOf(canonical).map((v) => escapeRe(v).replace(/ /g, "[\\s-]+"));
    re = new RegExp(`(?<![a-z0-9+#.])(?:${alternatives.join("|")})(?![a-z0-9+#])`, "i");
    regexCache.set(canonical, re);
  }
  return re;
}

/** Which of the candidate's canonical skills appear in a job's text. */
export function skillsInText(canonicalSkills: string[], text: string): string[] {
  return canonicalSkills.filter((s) => skillRegex(s).test(text));
}
