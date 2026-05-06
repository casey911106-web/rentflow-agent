import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';

/**
 * Global exception filter that:
 * 1. Forwards non-HttpException errors to Sentry (when SENTRY_DSN is set).
 * 2. Logs every unhandled error with request context to docker stdout.
 * 3. Returns a clean JSON response to the client.
 *
 * HttpException (4xx) is re-thrown as-is — those are user errors, not bugs.
 */
@Catch()
export class SentryFilter implements ExceptionFilter {
  private readonly logger = new Logger('SentryFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === 'string' ? { message: body, statusCode: status } : body);
      return;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`[${req.method} ${req.url}] ${err.message}`, err.stack);

    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setContext('request', {
          method: req.method,
          url: req.url,
          headers: { authorization: req.headers.authorization ? '[redacted]' : undefined },
        });
        Sentry.captureException(err);
      });
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Internal server error',
      statusCode: 500,
    });
  }
}
