import { GoogleGenAI } from '@google/genai';
import {
  LlmProviderError,
  type ChatRequest,
  type ChatResponse,
  type LlmErrorKind,
  type LlmProvider,
} from './llm.types';

function classifyStatus(status: number): LlmErrorKind {
  if (status === 429) return 'rate_limit';
  if ([401, 402, 403].includes(status)) return 'account_error';
  if (status >= 500) return 'server_error';
  return 'invalid_request';
}

function classifyGeminiError(error: unknown): LlmErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timed?\s*out/i.test(message)) return 'timeout';
  if (/429|RESOURCE_EXHAUSTED/i.test(message)) return 'rate_limit';
  if (/401|402|403|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message))
    return 'account_error';
  if (/\b5\d\d\b/i.test(message)) return 'server_error';
  if (/network|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message))
    return 'network_error';
  return 'other';
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: request.messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        config: { systemInstruction: request.system },
      });
      const text = response.text?.trim();
      if (!text)
        throw new LlmProviderError(this.name, 'other', 'Gemini returned no text');
      return { text, provider: this.name, model: this.model };
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      throw new LlmProviderError(
        this.name,
        classifyGeminiError(error),
        error instanceof Error ? error.message : 'Gemini request failed',
        error,
      );
    }
  }
}

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: request.system },
              ...request.messages,
            ],
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (error) {
      const kind =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
          ? 'timeout'
          : 'network_error';
      throw new LlmProviderError(this.name, kind, `${this.name} request failed`, error);
    }
    if (!response.ok)
      throw new LlmProviderError(
        this.name,
        classifyStatus(response.status),
        `${this.name} request failed with HTTP ${response.status}`,
      );
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim())
      throw new LlmProviderError(this.name, 'invalid_request', `${this.name} returned no text`);
    return { text: text.trim(), provider: this.name, model: this.model };
  }
}
