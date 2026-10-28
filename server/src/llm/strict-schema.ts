type JsonSchema = Record<string, unknown>;

function isRecord(v: unknown): v is JsonSchema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Verifies a JSON schema satisfies OpenAI strict Structured Outputs:
 * every object has additionalProperties:false and lists every property in `required`.
 * A zod `.optional()` field shows up here as a property missing from `required`.
 * Returns human-readable problems; empty array means OK.
 */
export function findStrictSchemaViolations(schema: unknown, path = "#"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((s, i) => findStrictSchemaViolations(s, `${path}/${i}`));
  if (!isRecord(schema)) return [];

  const problems: string[] = [];
  const props = schema.properties;
  const type = schema.type;
  const isObject = type === "object" || (Array.isArray(type) && type.includes("object")) || isRecord(props);

  if (isObject) {
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    const keys = isRecord(props) ? Object.keys(props) : [];
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of keys) {
      if (!required.includes(key)) problems.push(`${path}/properties/${key}: not required (use .nullable(), not .optional())`);
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && isRecord(value)) {
      for (const [prop, sub] of Object.entries(value)) problems.push(...findStrictSchemaViolations(sub, `${path}/properties/${prop}`));
    } else if (["items", "anyOf", "allOf", "oneOf", "definitions", "$defs"].includes(key)) {
      if (isRecord(value) && (key === "definitions" || key === "$defs")) {
        for (const [name, sub] of Object.entries(value)) problems.push(...findStrictSchemaViolations(sub, `${path}/${key}/${name}`));
      } else {
        problems.push(...findStrictSchemaViolations(value, `${path}/${key}`));
      }
    }
  }
  return problems;
}

export function assertStrictSchema(name: string, schema: unknown): void {
  const problems = findStrictSchemaViolations(schema);
  if (problems.length > 0) {
    throw new Error(`Schema "${name}" is not valid for OpenAI strict mode:\n${problems.join("\n")}`);
  }
}
