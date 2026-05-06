import type { AiClassifyOptions, AiClassifyResponse, AiCompleteOptions, AiCompleteResponse, AiProvider } from './provider.interface';
import { renderTemplate } from './template';

/**
 * Deterministic mock provider used in local dev + tests.
 * Returns the rendered prompt verbatim, optionally suffixed with a canned tail
 * so workflows can be exercised end-to-end without an external LLM.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async complete(opts: AiCompleteOptions): Promise<AiCompleteResponse> {
    const rendered = renderTemplate(opts.userPrompt, opts.variables ?? {});
    return {
      text: rendered.trim(),
      usage: { inputTokens: rendered.length, outputTokens: rendered.length },
      raw: { provider: 'mock' },
    };
  }

  async classify(opts: AiClassifyOptions): Promise<AiClassifyResponse> {
    const text = opts.text.toLowerCase();
    // Simple heuristic for owner availability replies + sentiment.
    const rules: Record<string, string[]> = {
      available: ['yes', 'still available', 'available', 'متاح'],
      rented: ['rented', 'taken', 'no', 'مؤجر'],
      blocked: ['blocked', 'busy until', 'reserved'],
      price_changed: ['new price', 'price changed', 'السعر'],
      unclear: [],
    };

    for (const label of opts.labels) {
      const keywords = rules[label] ?? [];
      if (keywords.some((kw) => text.includes(kw))) {
        return { label, confidence: 0.9 };
      }
    }
    return { label: opts.labels[0] ?? 'unclear', confidence: 0.5 };
  }
}
