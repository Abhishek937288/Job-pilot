import { env } from "../config/env.js";

export type ModelTier = "cheap" | "strong" | "web";

export function modelFor(tier: ModelTier): string {
  if (tier === "strong") return env.OPENAI_MODEL_STRONG;
  if (tier === "web") return env.OPENAI_MODEL_WEB_SEARCH;
  return env.OPENAI_MODEL_CHEAP;
}

function pricePerM(tier: ModelTier): { input: number; output: number } {
  return tier === "strong"
    ? { input: env.PRICE_STRONG_INPUT_PER_M, output: env.PRICE_STRONG_OUTPUT_PER_M }
    : { input: env.PRICE_CHEAP_INPUT_PER_M, output: env.PRICE_CHEAP_OUTPUT_PER_M };
}

/** Accumulates token usage and paid API calls for one pipeline run, for the cost measurement. */
export class Meter {
  inputTokens = 0;
  outputTokens = 0;
  llmCostUsd = 0;
  jsearchRequests = 0;
  webSearchCalls = 0;

  addTokens(tier: ModelTier, input: number, output: number): void {
    const p = pricePerM(tier);
    this.inputTokens += input;
    this.outputTokens += output;
    this.llmCostUsd += (input * p.input + output * p.output) / 1_000_000;
  }

  get costUsd(): number {
    return this.llmCostUsd + this.jsearchRequests * env.JSEARCH_COST_PER_REQUEST + this.webSearchCalls * env.WEB_SEARCH_COST_PER_CALL;
  }
}
