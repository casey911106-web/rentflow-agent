import { CloudApiWhatsAppAdapter, type CloudApiConfig } from './cloud-api.adapter';
import { MockWhatsAppAdapter } from './mock.adapter';
import type { WhatsAppAdapter } from './adapter.interface';

export interface WhatsAppFactoryConfig {
  adapter: 'mock' | 'cloud';
  businessNumberE164: string;
  cloud?: Omit<CloudApiConfig, 'businessNumberE164'>;
}

export function createWhatsAppAdapter(cfg: WhatsAppFactoryConfig): WhatsAppAdapter {
  if (cfg.adapter === 'mock') {
    return new MockWhatsAppAdapter(cfg.businessNumberE164);
  }
  if (!cfg.cloud) {
    throw new Error('WhatsApp Cloud API requires WHATSAPP_CLOUD_API_* env vars.');
  }
  return new CloudApiWhatsAppAdapter({ ...cfg.cloud, businessNumberE164: cfg.businessNumberE164 });
}
