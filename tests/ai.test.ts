import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIError, generateStructured } from "../apps/server/src/ai.js";

const schema = z.object({ answer: z.string() }).strict();
const jsonSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};
const spec = {
  system: "Return a short answer.",
  input: { question: "Why?" },
  schema,
  jsonSchema,
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function config(
  provider: "groq" | "google" | "compatible",
  responseMode: "structured" | "text" = "structured",
) {
  return {
    provider,
    model: provider === "google" ? "gemini-test" : "model-test",
    key: "secret-test-key",
    responseMode,
    ...(provider === "compatible"
      ? { baseUrl: "https://llm.example.test/v1" }
      : {}),
  } as const;
}

describe("generateStructured", () => {
  it("sends a native Groq structured-output request and parses its usage", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestKey = "";
    const result = await generateStructured(
      config("groq"),
      spec,
      async (input, init) => {
        expect(init?.redirect).toBe("error");
        requestUrl = String(input);
        requestKey = new Headers(init?.headers).get("authorization") ?? "";
        requestBody = JSON.parse(String(init?.body));
        return response({
          id: "groq-response-1",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({ answer: "Because." }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
        });
      },
    );

    expect(requestUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(requestKey).toBe("Bearer secret-test-key");
    expect(requestBody.response_format).toMatchObject({ type: "json_schema" });
    expect(result).toMatchObject({
      value: { answer: "Because." },
      tokens: 14,
      inputTokens: 11,
      outputTokens: 3,
      model: "model-test",
      responseId: "groq-response-1",
    });
  });

  it("uses Google's native generateContent wire format", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let keyHeader = "";
    const result = await generateStructured(
      config("google"),
      spec,
      async (input, init) => {
        requestUrl = String(input);
        keyHeader = new Headers(init?.headers).get("x-goog-api-key") ?? "";
        requestBody = JSON.parse(String(init?.body));
        return response({
          responseId: "google-response-1",
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ answer: "Because." }) }],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 8,
            candidatesTokenCount: 4,
            totalTokenCount: 12,
          },
        });
      },
    );

    expect(requestUrl).toContain(
      "generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(keyHeader).toBe("secret-test-key");
    expect(requestBody.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: expect.any(Object),
    });
    expect(result).toMatchObject({
      value: { answer: "Because." },
      tokens: 12,
      inputTokens: 8,
      outputTokens: 4,
      responseId: "google-response-1",
    });
  });

  it("uses text compatibility mode with the supplied base URL and JSON schema in its prompt", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    const result = await generateStructured(
      config("compatible", "text"),
      spec,
      async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return response({
          id: "compatible-response-1",
          choices: [
            {
              message: { role: "assistant", content: '{"answer":"Done."}' },
              finish_reason: "stop",
            },
          ],
        });
      },
    );

    expect(requestUrl).toBe("https://llm.example.test/v1/chat/completions");
    expect(requestBody).not.toHaveProperty("response_format");
    expect(
      (requestBody.messages as Array<{ content: string }>)[1]!.content,
    ).toContain(JSON.stringify(jsonSchema));
    expect(result).toMatchObject({
      value: { answer: "Done." },
      tokens: null,
      inputTokens: null,
      outputTokens: null,
      responseId: "compatible-response-1",
    });
  });

  it("reports schema-invalid output without exposing generated text", async () => {
    await expect(
      generateStructured(config("compatible", "text"), spec, async () =>
        response({
          id: "bad-response",
          choices: [
            {
              message: {
                role: "assistant",
                content: '{"secret":"private generated text"}',
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      ),
    ).rejects.toMatchObject({
      name: "AIError",
      code: "invalid_output",
      status: 502,
      uncertain: false,
      tokens: 7,
      inputTokens: 5,
      outputTokens: 2,
      responseId: "bad-response",
      message: "The model returned an invalid response.",
    });
  });

  it("maps credential failures to a safe message", async () => {
    let calls = 0;
    try {
      await generateStructured(config("groq"), spec, async () => {
        calls++;
        return response(
          { error: { message: "secret-test-key is invalid" } },
          401,
        );
      });
      throw new Error("expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AIError);
      expect(error).toMatchObject({
        code: "credentials",
        status: 401,
        uncertain: false,
      });
      expect((error as Error).message).toBe(
        "The provider rejected this connection.",
      );
      expect((error as Error).message).not.toContain("secret-test-key");
      expect(calls).toBe(1);
    }
  });

  it("classifies request timeouts as uncertain", async () => {
    await expect(
      generateStructured(config("groq"), spec, async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    ).rejects.toMatchObject({
      code: "timeout",
      status: 504,
      uncertain: true,
      tokens: null,
    });
  });

  it("does not retry uncertain provider failures and leaves unreported usage null", async () => {
    let calls = 0;
    try {
      await generateStructured(config("compatible"), spec, async () => {
        calls++;
        return response({ error: { message: "internal failure" } }, 503);
      });
      throw new Error("expected the request to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "provider_failure",
        uncertain: true,
        tokens: null,
        inputTokens: null,
        outputTokens: null,
      });
      expect(calls).toBe(1);
    }

    const successful = await generateStructured(
      config("groq"),
      spec,
      async () =>
        response({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({ answer: "OK" }),
              },
              finish_reason: "stop",
            },
          ],
        }),
    );
    expect(successful).toMatchObject({
      tokens: null,
      inputTokens: null,
      outputTokens: null,
    });
  });
});
