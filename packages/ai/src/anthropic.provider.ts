import Anthropic from '@anthropic-ai/sdk';
import type {
  AiCompleteOptions,
  AiCompleteResponse,
  AiProvider,
  SystemBlock,
} from './provider.interface';
import { renderTemplate } from './template';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Real Anthropic provider. Uses the official SDK.
 *
 * Caching strategy: pass `systemBlocks` with `cacheControl: 'ephemeral'` on the
 * stable prefix (brand voice, hard rules, property catalog, few-shot
 * examples). Volatile content (per-lead context, latest message) goes in the
 * user message. The cache key is the rendered byte prefix; any change anywhere
 * in the system blocks invalidates everything after it.
 *
 * For Sonnet 4.6 we use adaptive thinking by default — the model decides when
 * and how much to think. Effort defaults to "medium" for a good cost/quality
 * balance on suggestion-style outputs.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) {
      throw new Error('AnthropicProvider: apiKey is required.');
    }
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
    this.defaultModel = config.model ?? DEFAULT_MODEL;
  }

  async complete(opts: AiCompleteOptions): Promise<AiCompleteResponse> {
    const variables = opts.variables ?? {};
    const userText = renderTemplate(opts.userPrompt, variables);

    // System: prefer structured blocks (with cache control). Fall back to a
    // single string if only `systemPrompt` was provided.
    const systemBlocks = this.buildSystemBlocks(opts.systemBlocks, opts.systemPrompt, variables);

    const requestParams: Anthropic.MessageCreateParams = {
      model: opts.model ?? this.defaultModel,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: userText }],
    };

    if (systemBlocks.length > 0) {
      requestParams.system = systemBlocks;
    }

    if (opts.jsonSchema) {
      // Structured outputs via output_config.format. Messages.create supports
      // this on Sonnet 4.6+. Cast through `any` because the SDK type doesn't
      // expose the field on the bare MessageCreateParams (it lives on
      // messages.parse() in the typed surface).
      (requestParams as unknown as Record<string, unknown>).output_config = {
        format: { type: 'json_schema', schema: opts.jsonSchema },
      };
    }

    const response = await this.client.messages.create(requestParams);

    const text = this.extractText(response);
    const parsedJson = opts.jsonSchema ? this.tryParseJson(text) : undefined;

    return {
      text,
      parsedJson,
      stopReason: response.stop_reason ?? undefined,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
      raw: response,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // helpers
  // ─────────────────────────────────────────────────────────────────────────

  private buildSystemBlocks(
    structured: SystemBlock[] | undefined,
    plain: string | undefined,
    variables: Record<string, unknown>,
  ): Anthropic.TextBlockParam[] {
    if (structured && structured.length > 0) {
      return structured.map((b) => {
        const block: Anthropic.TextBlockParam = {
          type: 'text',
          text: renderTemplate(b.text, variables),
        };
        if (b.cacheControl === 'ephemeral') {
          block.cache_control = { type: 'ephemeral' };
        }
        return block;
      });
    }
    if (plain) {
      return [{ type: 'text', text: renderTemplate(plain, variables) }];
    }
    return [];
  }

  private extractText(response: Anthropic.Message): string {
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  private tryParseJson(text: string): unknown {
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      // The model may have wrapped the JSON in a code fence or added prose.
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch?.[1]) {
        try {
          return JSON.parse(fenceMatch[1].trim());
        } catch {
          // fall through
        }
      }
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          return JSON.parse(braceMatch[0]);
        } catch {
          // fall through
        }
      }
      return undefined;
    }
  }
}
