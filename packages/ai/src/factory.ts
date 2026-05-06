import { MockAiProvider } from './mock.provider';
import { AnthropicProvider } from './anthropic.provider';
import type { AiProvider } from './provider.interface';

export interface AiFactoryConfig {
  provider: 'mock' | 'openai' | 'anthropic';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Returns an AI provider based on env config. Anthropic is the production
 * provider. The mock keeps local dev / tests deterministic and free.
 */
export function createAiProvider(config: AiFactoryConfig): AiProvider {
  switch (config.provider) {
    case 'mock':
      return new MockAiProvider();
    case 'anthropic':
      if (!config.apiKey) {
        throw new Error(
          'AI_PROVIDER=anthropic but AI_API_KEY is not set. Get a key at https://console.anthropic.com or switch AI_PROVIDER=mock for local dev.',
        );
      }
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
      });
    case 'openai':
      throw new Error('OpenAI adapter not implemented. Use AI_PROVIDER=anthropic or =mock.');
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown AI provider: ${_exhaustive as string}`);
    }
  }
}
