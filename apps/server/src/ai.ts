import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
} from "ai";
import type { AISettings } from "@lead/contracts";
import type { ZodType } from "zod";
import { AppError } from "./security.js";

export type AIModelConfig = AISettings & { key: string; baseUrl?: string };

export type AIResult<T> = {
  value: T;
  tokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string;
  latencyMs: number;
  responseId?: string;
};

export type AIErrorCode =
  | "credentials"
  | "quota"
  | "timeout"
  | "invalid_output"
  | "unsupported_model"
  | "provider_failure";

export class AIError extends AppError {
  constructor(
    public code: AIErrorCode,
    message: string,
    public uncertain: boolean,
    public tokens: number | null = null,
    public inputTokens: number | null = null,
    public outputTokens: number | null = null,
    public latencyMs = 0,
    public responseId?: string,
  ) {
    const status =
      code === "credentials"
        ? 401
        : code === "quota"
          ? 429
          : code === "timeout"
            ? 504
            : code === "unsupported_model"
              ? 400
              : 502;
    super(status, message);
    this.name = "AIError";
  }
}

type Usage = {
  tokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};
type Spec<T> = {
  system: string;
  input: unknown;
  schema: ZodType<T>;
  jsonSchema: Record<string, unknown>;
};

function usageOf(value: unknown): Usage {
  if (!value || typeof value !== "object")
    return { tokens: null, inputTokens: null, outputTokens: null };
  const usage = value as {
    totalTokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  };
  const inputTokens = Number.isFinite(usage.inputTokens)
    ? (usage.inputTokens as number)
    : null;
  const outputTokens = Number.isFinite(usage.outputTokens)
    ? (usage.outputTokens as number)
    : null;
  const total = Number.isFinite(usage.totalTokens)
    ? (usage.totalTokens as number)
    : inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null;
  return { tokens: total, inputTokens, outputTokens };
}

function responseIdOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function isTimeout(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  const name = error instanceof Error ? error.name : "";
  const causeName = cause instanceof Error ? cause.name : "";
  return /timeout|abort/i.test(name) || /timeout|abort/i.test(causeName);
}

function promptFor(spec: Spec<unknown>, includeSchema: boolean): string {
  const input = JSON.stringify(spec.input);
  return [
    `Input:\n${input ?? "null"}`,
    includeSchema
      ? `Return only JSON matching this JSON Schema:\n${JSON.stringify(spec.jsonSchema)}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function errorFrom(error: unknown, elapsed: number): AIError {
  if (isTimeout(error))
    return new AIError(
      "timeout",
      "The model request timed out; its completion is unknown.",
      true,
      null,
      null,
      null,
      elapsed,
    );
  if (NoObjectGeneratedError.isInstance(error)) {
    const usage = usageOf(error.usage);
    return new AIError(
      "invalid_output",
      "The model returned an invalid response.",
      false,
      usage.tokens,
      usage.inputTokens,
      usage.outputTokens,
      elapsed,
      responseIdOf(error.response),
    );
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const usage = { tokens: null, inputTokens: null, outputTokens: null };
    if (status === 401 || status === 403)
      return new AIError(
        "credentials",
        "The provider rejected this connection.",
        false,
        ...Object.values(usage),
        elapsed,
      );
    if (status === 429)
      return new AIError(
        "quota",
        "The provider's usage limit was reached.",
        false,
        ...Object.values(usage),
        elapsed,
      );
    if (status === 400 || status === 404)
      return new AIError(
        "unsupported_model",
        "The provider does not support this model or request.",
        false,
        ...Object.values(usage),
        elapsed,
      );
    if (status === undefined || status >= 500)
      return new AIError(
        "provider_failure",
        "The provider may have received the request, but did not return a usable response.",
        true,
        ...Object.values(usage),
        elapsed,
      );
    return new AIError(
      "provider_failure",
      "The provider could not complete the request.",
      false,
      ...Object.values(usage),
      elapsed,
    );
  }
  return new AIError(
    "provider_failure",
    "The provider could not complete the request.",
    true,
    null,
    null,
    null,
    elapsed,
  );
}

/** Performs exactly one provider request using credentials and fetch scoped to this call. */
export async function generateStructured<T>(
  config: AIModelConfig,
  spec: Spec<T>,
  fetcher: typeof fetch = fetch,
): Promise<AIResult<T>> {
  if (!config.key)
    throw new AIError(
      "credentials",
      "A provider connection is required.",
      false,
    );
  if (config.provider === "compatible" && !config.baseUrl?.trim())
    throw new AIError(
      "provider_failure",
      "The compatible provider URL is unavailable.",
      false,
    );

  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const safeFetcher: typeof fetch = (url, init) =>
    fetcher(url, { ...init, redirect: "error" });
  const provider =
    config.provider === "groq"
      ? createGroq({ apiKey: config.key, fetch: safeFetcher })
      : config.provider === "google"
        ? createGoogleGenerativeAI({ apiKey: config.key, fetch: safeFetcher })
        : createOpenAICompatible({
            name: "compatible",
            baseURL: config.baseUrl!.trim(),
            apiKey: config.key,
            supportsStructuredOutputs: true,
            fetch: safeFetcher,
          });
  const model = provider(config.model);

  try {
    const result = await generateText({
      model,
      system: spec.system,
      prompt: promptFor(spec, config.responseMode === "text"),
      ...(config.responseMode === "structured"
        ? { output: Output.object({ schema: jsonSchema(spec.jsonSchema) }) }
        : {}),
      maxOutputTokens: 2000,
      maxRetries: 0,
      timeout: 60_000,
    });

    const parsed =
      config.responseMode === "structured"
        ? spec.schema.safeParse(result.output)
        : parseText(result.text, spec.schema);
    if (!parsed.success) {
      const usage = usageOf(result.usage);
      throw new AIError(
        "invalid_output",
        "The model returned an invalid response.",
        false,
        usage.tokens,
        usage.inputTokens,
        usage.outputTokens,
        elapsed(),
        responseIdOf(result.steps.at(-1)?.response),
      );
    }
    const usage = usageOf(result.usage);
    return {
      value: parsed.data,
      ...usage,
      model: config.model,
      latencyMs: elapsed(),
      responseId: responseIdOf(result.steps.at(-1)?.response),
    };
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw errorFrom(error, elapsed());
  }
}

function parseText<T>(text: string, schema: ZodType<T>) {
  try {
    return schema.safeParse(JSON.parse(text));
  } catch {
    return schema.safeParse(undefined);
  }
}
