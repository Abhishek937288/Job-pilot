import OpenAI from "openai";
import type { ResponseInputContent, Tool, ResponseIncludable, Response as OpenAIResponse } from "openai/resources/responses/responses";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { modelFor, type Meter, type ModelTier } from "./meter.js";
import { assertStrictSchema } from "./strict-schema.js";

export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 3, timeout: 120_000 });

export type StructuredResult<T> =
  | { ok: true; data: T; response: OpenAIResponse; attempts: number }
  | { ok: false; reason: "validation" | "refusal" | "incomplete"; message: string; attempts: number };

export interface StructuredCallOptions<S extends z.ZodType> {
  /** Schema name sent to OpenAI (a-z, 0-9, _ and -). */
  name: string;
  schema: S;
  /** Static instructions. Kept first and identical across calls so OpenAI's prompt cache can reuse it. */
  system: string;
  /** Untrusted data (resume text, jobs) goes here, never into `system`. */
  user: string | ResponseInputContent[];
  tier: ModelTier;
  meter?: Meter;
  tools?: Tool[];
  include?: ResponseIncludable[];
  maxOutputTokens?: number;
}

const MAX_ATTEMPTS = 2; // first try + one retry on invalid output

/**
 * The only way LLM calls are made: strict Structured Outputs, validated again with zod, one retry on
 * invalid output. Returns a failure instead of throwing for invalid output or refusals; transport and
 * API errors still throw (the SDK already retries those).
 */
export async function structuredCall<S extends z.ZodType>(opts: StructuredCallOptions<S>): Promise<StructuredResult<z.infer<S>>> {
  const format = zodTextFormat(opts.schema, opts.name);
  assertStrictSchema(opts.name, format.schema);
  const model = modelFor(opts.tier);
  let lastFailure: { reason: "validation" | "refusal" | "incomplete"; message: string } = { reason: "validation", message: "no attempts" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await openai.responses.create({
      model,
      store: false,
      input: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      text: { format: { type: "json_schema", name: opts.name, schema: format.schema, strict: true } },
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.include ? { include: opts.include } : {}),
      ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
    });

    if (response.usage) {
      opts.meter?.addTokens(opts.tier, response.usage.input_tokens, response.usage.output_tokens);
      logger.debug(
        { llm: opts.name, model, attempt, input: response.usage.input_tokens, cached: response.usage.input_tokens_details?.cached_tokens, output: response.usage.output_tokens },
        "llm usage",
      );
    }
    if (opts.meter) opts.meter.webSearchCalls += response.output.filter((o) => o.type === "web_search_call").length;

    const refusal = response.output.flatMap((item) => (item.type === "message" ? item.content : [])).find((c) => c.type === "refusal");
    if (refusal && refusal.type === "refusal") return { ok: false, reason: "refusal", message: refusal.refusal, attempts: attempt };

    if (response.status === "incomplete") {
      lastFailure = { reason: "incomplete", message: `incomplete: ${response.incomplete_details?.reason ?? "unknown"}` };
      logger.warn({ llm: opts.name, attempt }, lastFailure.message);
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(response.output_text);
    } catch {
      lastFailure = { reason: "validation", message: "response was not valid JSON" };
      continue;
    }
    const parsed = opts.schema.safeParse(json);
    if (parsed.success) return { ok: true, data: parsed.data, response, attempts: attempt };
    lastFailure = { reason: "validation", message: parsed.error.message };
    logger.warn({ llm: opts.name, attempt, issues: parsed.error.issues.slice(0, 5) }, "llm output failed validation");
  }
  return { ok: false, ...lastFailure, attempts: MAX_ATTEMPTS };
}

/** Wraps untrusted text so the model can tell data from instructions. */
export function asData(tag: string, text: string): string {
  return `<${tag}>\n${text.replaceAll(`</${tag}>`, `</ ${tag}>`)}\n</${tag}>`;
}
