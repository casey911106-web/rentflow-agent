import { Injectable } from '@nestjs/common';
import { createAiProvider, type AiProvider } from '@rentflow/ai';

@Injectable()
export class AiProviderRef {
  readonly provider: AiProvider;

  constructor() {
    this.provider = createAiProvider({
      provider: (process.env.AI_PROVIDER ?? 'mock') as 'mock' | 'openai' | 'anthropic',
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL,
      baseUrl: process.env.AI_BASE_URL,
    });
  }
}
