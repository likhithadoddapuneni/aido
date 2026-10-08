import type { FastifyBaseLogger } from 'fastify';
import type { Notification, Notifier, OtpSender } from '../ports.ts';

/**
 * Development notifier and OTP sender: write to the log instead of a channel. Production wires real
 * adapters (push, WhatsApp, SMS, email); the application cannot tell the difference.
 */
export class LogNotifier implements Notifier {
  private readonly log: FastifyBaseLogger;
  constructor(log: FastifyBaseLogger) {
    this.log = log;
  }
  async send(n: Notification): Promise<void> {
    this.log.info({ notification: n }, 'notification');
  }
}

export class LogOtpSender implements OtpSender {
  private readonly log: FastifyBaseLogger;
  private readonly reveal: boolean;
  /** `reveal` is for demo machines only (config refuses it in production): the code is printed so a tester can sign in. */
  constructor(log: FastifyBaseLogger, reveal = false) {
    this.log = log;
    this.reveal = reveal;
  }
  async send(
    channel: 'sms' | 'whatsapp' | 'email',
    destination: string,
    code: string,
  ): Promise<void> {
    this.log.warn(
      {
        channel,
        destination: this.reveal ? destination : `${destination.slice(0, 4)}…`,
        ...(this.reveal ? { code } : {}),
      },
      this.reveal ? `DEMO OTP for ${destination}: ${code}` : 'OTP requested (development sender)',
    );
  }
}
