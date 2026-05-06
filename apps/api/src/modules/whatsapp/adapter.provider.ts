import { Injectable } from '@nestjs/common';
import { createWhatsAppAdapter, type WhatsAppAdapter } from '@rentflow/integrations';

@Injectable()
export class WhatsAppAdapterProvider {
  readonly adapter: WhatsAppAdapter;

  constructor() {
    const businessNumberE164 = process.env.WHATSAPP_BUSINESS_PHONE_E164 ?? '+971585063316';
    const adapterChoice = (process.env.WHATSAPP_ADAPTER ?? 'mock') as 'mock' | 'cloud';

    this.adapter = createWhatsAppAdapter({
      adapter: adapterChoice,
      businessNumberE164,
      cloud: adapterChoice === 'cloud'
        ? {
            phoneNumberId: process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID ?? '',
            accessToken: process.env.WHATSAPP_CLOUD_API_ACCESS_TOKEN ?? '',
            appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
          }
        : undefined,
    });
  }
}
