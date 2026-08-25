import { Logger } from '@nestjs/common';
import {
  LlmProviderError,
  type ChatRequest,
  type ChatResponse,
  type LlmErrorKind,
  type LlmProvider,
} from './llm.types';

const retryable = new Set<LlmErrorKind>([
  'rate_limit',
  'timeout',
  'server_error',
  'network_error',
]);

export class LlmRouter implements LlmProvider {
  readonly name = 'router';
  private readonly logger = new Logger(LlmRouter.name);
  private readonly failures = new Map<string, { count: number; openedAt?: number }>();

  constructor(
    private readonly providers: LlmProvider[],
    private readonly retryCount: number,
    private readonly retryDelayMs: number,
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    let lastError: unknown;
    for (const provider of this.providers) {
      if (!this.available(provider.name)) continue;
      try {
        const response = await this.withRetry(provider, request);
        this.failures.delete(provider.name);
        return response;
      } catch (error) {
        lastError = error;
        this.recordFailure(provider.name);
        if (error instanceof LlmProviderError && error.kind === 'invalid_request')
          throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('LLM router exhausted every configured provider');
  }

  private async withRetry(provider: LlmProvider, request: ChatRequest): Promise<ChatResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retryCount; attempt++) {
      try {
        return await provider.chat(request);
      } catch (error) {
        lastError = error;
        const kind = error instanceof LlmProviderError ? error.kind : 'other';
        this.logger.warn(`LLM attempt failed: provider=${provider.name} kind=${kind}`);
        if (!retryable.has(kind) || attempt === this.retryCount) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
    throw lastError;
  }

  private available(provider: string): boolean {
    const state = this.failures.get(provider);
    return !state?.openedAt || Date.now() - state.openedAt >= this.cooldownMs;
  }

  private recordFailure(provider: string): void {
    const count = (this.failures.get(provider)?.count ?? 0) + 1;
    this.failures.set(provider, {
      count,
      openedAt: count >= this.failureThreshold ? Date.now() : undefined,
    });
  }
}
