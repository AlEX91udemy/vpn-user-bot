import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import configuration from '../config/configuration';
import { GeminiProvider, OpenAiCompatibleProvider } from './llm.providers';
import { LlmRouter } from './llm.router';
import type { LlmProvider } from './llm.types';
import { UserAssistantService } from './user-assistant.service';
import { USER_LLM } from './user-llm.token';

const llmProvider = {
  provide: USER_LLM,
  inject: [configuration.KEY],
  useFactory: (config: ConfigType<typeof configuration>): LlmProvider | null => {
    const providers = new Map<string, LlmProvider>();
    const gemini = config.llm.providers.gemini;
    if (gemini.apiKey)
      providers.set('gemini', new GeminiProvider(gemini.apiKey, gemini.model));
    for (const id of ['groq', 'openrouter', 'cerebras', 'nvidia'] as const) {
      const provider = config.llm.providers[id];
      if (provider.apiKey && provider.model && provider.baseUrl)
        providers.set(id, new OpenAiCompatibleProvider(
          id, provider.baseUrl, provider.apiKey, provider.model,
          config.llm.requestTimeoutMs,
        ));
    }
    const chain = config.llm.priorityChain
      .map((id) => providers.get(id))
      .filter((provider): provider is LlmProvider => Boolean(provider));
    return chain.length === 0 ? null : new LlmRouter(
      chain,
      config.llm.retryCount,
      config.llm.retryDelayMs,
      config.llm.healthFailureThreshold,
      config.llm.healthCooldownMs,
    );
  },
};

@Module({
  providers: [llmProvider, UserAssistantService],
  exports: [UserAssistantService],
})
export class UserAssistantModule {}
