/**
 * Generic AI provider interface used by the API. The implementation can be a
 * mock (for tests/dev) or a real adapter (Anthropic).
 */

/**
 * One block of system content. We model these explicitly (rather than passing
 * a single string) so callers can mark cache breakpoints — anything before
 * `cacheControl: 'ephemeral'` is cached for ~5 minutes by the provider.
 */
export interface SystemBlock {
  text: string;
  cacheControl?: 'ephemeral';
}

/**
 * Optional image attachment for the user turn. Used when a WhatsApp guest
 * sent a screenshot of the property they want and we need Claude to "see"
 * which listing they're pointing at.
 */
export interface UserImage {
  /** Base64-encoded image payload (no data: prefix). */
  base64: string;
  /** image/jpeg, image/png, image/webp, image/gif. */
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

export interface AiCompleteOptions {
  /** Optional plain string system prompt (no caching). */
  systemPrompt?: string;
  /**
   * Optional structured system prompt with cache control. If provided, this
   * takes precedence over `systemPrompt`.
   */
  systemBlocks?: SystemBlock[];
  /** The user message. */
  userPrompt: string;
  /**
   * Optional images attached to the user turn (vision input). Sent in
   * order, before the userPrompt text. The provider may ignore these if
   * the underlying model doesn't support vision.
   */
  userImages?: UserImage[];
  variables?: Record<string, string | number | boolean | null>;
  maxTokens?: number;
  /**
   * Request a structured JSON response that conforms to the given schema.
   * The provider returns parsed JSON in `parsedJson` when supported.
   */
  jsonSchema?: Record<string, unknown>;
  /** Optional override for the model id. */
  model?: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Tokens written to cache this request. */
  cacheCreationInputTokens?: number;
  /** Tokens served from cache this request. */
  cacheReadInputTokens?: number;
}

export interface AiCompleteResponse {
  /** Plain text content of the response. */
  text: string;
  /** Parsed JSON when `jsonSchema` was provided and the provider supports it. */
  parsedJson?: unknown;
  usage?: AiUsage;
  /** Underlying provider response for debugging / observability. */
  raw?: unknown;
  /** Reason the model stopped (e.g. 'end_turn', 'max_tokens', 'refusal'). */
  stopReason?: string;
  /** Echo of the model id used. */
  model?: string;
}

export interface AiClassifyOptions {
  text: string;
  labels: string[];
}

export interface AiClassifyResponse {
  label: string;
  confidence: number;
}

export interface AiProvider {
  readonly name: string;
  complete(opts: AiCompleteOptions): Promise<AiCompleteResponse>;
  classify?(opts: AiClassifyOptions): Promise<AiClassifyResponse>;
}
