import { Body, Controller, Get, Headers, HttpCode, Logger, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from './adapter.provider';
import { InboundRouter } from './inbound.router';

@ApiTags('webhooks')
@Controller()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterProvider: WhatsAppAdapterProvider,
    private readonly router: InboundRouter,
  ) {}

  /**
   * GET /webhooks/whatsapp — Meta verification challenge.
   */
  @Public()
  @Get('webhooks/whatsapp')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    if (mode === 'subscribe' && token === (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? 'local-dev-verify-token')) {
      return challenge ?? 'ok';
    }
    throw new UnauthorizedException('Invalid verify token');
  }

  /**
   * POST /webhooks/whatsapp — inbound messages from Cloud API.
   */
  @Public()
  @HttpCode(200)
  @Post('webhooks/whatsapp')
  async inbound(
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const adapter = this.adapterProvider.adapter;
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));

    if (adapter.name === 'cloud_api' && !adapter.verifyWebhookSignature(headers, raw)) {
      throw new UnauthorizedException('Invalid signature');
    }

    await this.prisma.webhookLog.create({
      data: {
        source: 'whatsapp',
        signatureOk: true,
        rawBody: body as object,
        headers: headers as object,
      },
    });

    const messages = adapter.parseInbound(body);
    for (const msg of messages) {
      try {
        await this.router.route(msg);
      } catch (err) {
        this.logger.error(`Failed to route inbound message: ${(err as Error).message}`);
      }
    }
    return { received: messages.length };
  }

  /**
   * POST /whatsapp/mock/inbound — dev-only convenience to simulate inbound.
   * Not gated by signature; only useful when WHATSAPP_ADAPTER=mock.
   */
  @Public()
  @HttpCode(200)
  @Post('whatsapp/mock/inbound')
  async mockInbound(@Body() body: { from: string; text: string; messageId?: string }) {
    if ((process.env.WHATSAPP_ADAPTER ?? 'mock') !== 'mock') {
      throw new UnauthorizedException('Mock inbound only available when WHATSAPP_ADAPTER=mock');
    }
    const adapter = this.adapterProvider.adapter;
    const messages = adapter.parseInbound(body);
    const out = [];
    for (const msg of messages) {
      out.push(await this.router.route(msg));
    }
    return { received: messages.length, results: out };
  }
}
