import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { assertStrictSchema } from "./strict-schema.js";

export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 3, timeout: 120_000 });

export type ModelTier = "cheap" | "strong";

export function modelFor(tier: ModelTier): string {
  return tier === "cheap" ? env.OPENAI_MODEL_CHEAP : env.OPENAI_MODEL_STRONG;
}

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type StructuredResult<T> =
  | { ok: true; data: T; usage: TokenUsage[]; attempts: number }
  | { ok: false; reason: "validation" | "refusal" | "incomplete"; message: string; usage: TokenUsage[]; attempts: number };

export interface StructuredCallOptions<S extends z.ZodType> {
  /** Schema name sent to OpenAI (a-z, 0-9, _ and -). */
  name: string;
  schema: S;
  system: string;
  user: string;
  tier: ModelTier;
}

const MAX_ATTEMPTS = 2; // first try + one retry on validation failure

/**
 * The only way LLM calls are made. Uses strict Structured Outputs, validates the
 * response with zod, retries once on invalid output, and reports failure instead of
 * throwing so callers can mark the item needsReview. Transport/API errors still throw
 * (the SDK already retries those; queue jobs retry on top).
 */
export async function structuredCall<S extends z.ZodType>(opts: StructuredCallOptions<S>): Promise<StructuredResult<z.infer<S>>> {
  const format = zodTextFormat(opts.schema, opts.name);
  assertStrictSchema(opts.name, format.schema);

  const model = modelFor(opts.tier);
  const usage: TokenUsage[] = [];
  let lastFailure: { reason: "validation" | "refusal" | "incomplete"; message: string } = {
    reason: "validation",
    message: "no attempts made",
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await openai.responses.create({
      model,
      store: false,
      input: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      text: {
        format: { type: "json_schema", name: opts.name, schema: format.schema, strict: true },
      },
    });

    if (response.usage) {
      const u = {
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      };
      usage.push(u);
      logger.info({ llm: opts.name, attempt, ...u }, "llm usage");
    }

    const refusal = response.output
      .flatMap((item) => (item.type === "message" ? item.content : []))
      .find((c) => c.type === "refusal");
    if (refusal && refusal.type === "refusal") {
      // A refusal won't change on retry.
      return { ok: false, reason: "refusal", message: refusal.refusal, usage, attempts: attempt };
    }

    if (response.status === "incomplete") {
      lastFailure = { reason: "incomplete", message: `incomplete: ${response.incomplete_details?.reason ?? "unknown"}` };
      logger.warn({ llm: opts.name, attempt, ...lastFailure }, "llm output incomplete");
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(response.output_text);
    } catch {
      lastFailure = { reason: "validation", message: "response was not valid JSON" };
      logger.warn({ llm: opts.name, attempt }, lastFailure.message);
      continue;
    }

    const parsed = opts.schema.safeParse(json);
    if (parsed.success) return { ok: true, data: parsed.data, usage, attempts: attempt };

    lastFailure = { reason: "validation", message: parsed.error.message };
    logger.warn({ llm: opts.name, attempt, issues: parsed.error.issues }, "llm output failed zod validation");
  }

  return { ok: false, ...lastFailure, usage, attempts: MAX_ATTEMPTS };
}
