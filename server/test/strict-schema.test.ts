import { profileExtractionSchema } from "@jobpilot/shared";
import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { findStrictSchemaViolations } from "../src/llm/strict-schema.js";

describe("OpenAI strict schema conversion (zod 4 via openai/helpers/zod)", () => {
  it("profile extraction schema is strict-compliant", () => {
    const { schema, strict } = zodTextFormat(profileExtractionSchema, "resume_profile");
    expect(strict).toBe(true);
    expect(findStrictSchemaViolations(schema)).toEqual([]);
  });

  it("nullable fields are required and allow null", () => {
    const { schema } = zodTextFormat(profileExtractionSchema, "resume_profile");
    const props = schema.properties as Record<string, { type: unknown }>;
    expect(schema.required).toContain("remotePreference");
    expect(props.name?.type).toEqual(["string", "null"]);
  });

  it("detects violations in a hand-written non-strict schema", () => {
    const bad = {
      type: "object",
      properties: { a: { type: "string" }, nested: { type: "object", properties: { b: { type: "number" } } } },
      required: ["nested"],
    };
    const problems = findStrictSchemaViolations(bad);
    expect(problems).toContain("#: additionalProperties must be false");
    expect(problems.some((p) => p.includes("/properties/a: not required"))).toBe(true);
    expect(problems.some((p) => p.startsWith("#/properties/nested: additionalProperties"))).toBe(true);
  });

  it("a .optional() field never reaches OpenAI silently", () => {
    const withOptional = z.object({ a: z.string(), b: z.string().optional() });
    let problems: string[];
    try {
      problems = findStrictSchemaViolations(zodTextFormat(withOptional, "x").schema);
    } catch {
      problems = ["helper rejected .optional()"];
    }
    expect(problems.length).toBeGreaterThan(0);
  });
});
