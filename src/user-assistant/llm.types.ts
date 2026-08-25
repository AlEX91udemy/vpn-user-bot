export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface ChatRequest {
  messages: ChatMessage[];
  system: string;
}

export interface ChatResponse {
  text: string;
  provider: string;
  model: string;
}

export type LlmErrorKind =
  | 'rate_limit'
  | 'timeout'
  | 'server_error'
  | 'network_error'
  | 'account_error'
  | 'invalid_request'
  | 'other';

export class LlmProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export interface LlmProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
