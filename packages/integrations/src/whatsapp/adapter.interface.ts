export type WaMessageType = 'text' | 'image' | 'video' | 'document' | 'template' | 'interactive';

export interface SendTextOptions {
  to: string;            // E.164
  body: string;
  conversationId: string;
}

export interface SendTemplateOptions {
  to: string;
  template: { name: string; languageCode: string };
  variables: Record<string, string>;
  conversationId: string;
}

export interface SendMediaOptions {
  to: string;
  type: 'image' | 'video' | 'document';
  mediaUrl: string;
  caption?: string;
  conversationId: string;
}

export interface InteractiveButton {
  /** Up to 256 chars. Returned verbatim when the user taps it. */
  id: string;
  /** Up to 20 chars. Shown on the button. */
  title: string;
}

export interface SendInteractiveButtonsOptions {
  to: string;
  body: string;
  /** Optional ≤60 char header text shown above the body. */
  header?: string;
  /** Optional ≤60 char footer text shown below buttons. */
  footer?: string;
  /** 1–3 buttons. */
  buttons: InteractiveButton[];
  conversationId: string;
}

export interface SendResult {
  externalId: string;
  status: 'sent' | 'mock_sent' | 'failed';
  error?: string;
  raw?: unknown;
}

export interface InboundButtonReply {
  /** The `id` field from the button definition (echoed back). */
  id: string;
  title: string;
}

export interface InboundMessage {
  externalId: string;
  from: string;          // E.164
  toBusinessNumber: string;
  type: WaMessageType;
  body?: string;
  mediaUrl?: string;
  /** Present when type === 'interactive' and the user tapped a reply button. */
  buttonReply?: InboundButtonReply;
  receivedAt: Date;
  raw?: unknown;
}

export interface WhatsAppAdapter {
  readonly name: string;
  sendText(opts: SendTextOptions): Promise<SendResult>;
  sendTemplate(opts: SendTemplateOptions): Promise<SendResult>;
  sendMedia(opts: SendMediaOptions): Promise<SendResult>;
  sendInteractiveButtons(opts: SendInteractiveButtonsOptions): Promise<SendResult>;
  verifyWebhookSignature(headers: Record<string, string>, rawBody: Buffer): boolean;
  parseInbound(payload: unknown): InboundMessage[];
}
