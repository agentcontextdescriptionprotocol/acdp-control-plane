import { LoggerService } from '@nestjs/common';
import pino from 'pino';

export class PinoLogger implements LoggerService {
  private readonly logger: pino.Logger;

  constructor(level = 'info', isDevelopment = false) {
    let transport: pino.TransportSingleOptions | undefined;
    if (isDevelopment) {
      try {
        require.resolve('pino-pretty');
        transport = { target: 'pino-pretty', options: { colorize: true } };
      } catch {
        // pino-pretty not installed — fall back to plain JSON
      }
    }
    this.logger = pino({ level, ...(transport ? { transport } : {}) });
  }

  log(message: string, context?: string): void {
    this.logger.info({ context }, message);
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, message);
  }

  warn(message: string, context?: string): void {
    this.logger.warn({ context }, message);
  }

  debug(message: string, context?: string): void {
    this.logger.debug({ context }, message);
  }

  verbose(message: string, context?: string): void {
    this.logger.trace({ context }, message);
  }
}
