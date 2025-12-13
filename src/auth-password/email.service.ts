import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProblemException } from '../common/errors/problem.exception';
import { ErrorCode } from '../common/errors/error-codes';

export abstract class EmailService {
  abstract sendVerification(email: string, token: string): Promise<void>;
  abstract sendPasswordReset(email: string, token: string): Promise<void>;
}

@Injectable()
export class MockEmailService extends EmailService {
  private static verificationTokens = new Map<string, string[]>();
  private static resetTokens = new Map<string, string[]>();

  async sendVerification(email: string, token: string) {
    MockEmailService.storeToken(MockEmailService.verificationTokens, email, token);
    console.log(`[email] verification token for ${email}: ${token}`);
  }

  async sendPasswordReset(email: string, token: string) {
    MockEmailService.storeToken(MockEmailService.resetTokens, email, token);
    console.log(`[email] password reset token for ${email}: ${token}`);
  }

  static pullLatestVerificationToken(email: string): string | undefined {
    return MockEmailService.pullLatest(MockEmailService.verificationTokens, email);
  }

  static pullLatestResetToken(email: string): string | undefined {
    return MockEmailService.pullLatest(MockEmailService.resetTokens, email);
  }

  static resetAllMocks() {
    MockEmailService.verificationTokens.clear();
    MockEmailService.resetTokens.clear();
  }

  private static storeToken(bucket: Map<string, string[]>, email: string, token: string) {
    const existing = bucket.get(email) ?? [];
    existing.push(token);
    bucket.set(email, existing);
  }

  private static pullLatest(bucket: Map<string, string[]>, email: string) {
    const items = bucket.get(email);
    if (!items || items.length === 0) return undefined;
    const token = items.pop();
    if (!items.length) bucket.delete(email);
    return token;
  }
}

@Injectable()
export class ResendEmailService extends EmailService {
  private readonly logger = new Logger(ResendEmailService.name);
  private readonly apiKey?: string;
  private readonly fromAddress?: string;
  private readonly fromName?: string;
  private readonly verificationUrl?: string;
  private readonly passwordResetUrl?: string;
  private readonly baseUrl = 'https://api.resend.com';

  constructor(private readonly config: ConfigService) {
    super();
    this.apiKey = this.config.get<string>('RESEND_API_KEY');
    this.fromAddress = this.config.get<string>('EMAIL_FROM_ADDRESS');
    this.fromName = this.config.get<string>('EMAIL_FROM_NAME');
    this.verificationUrl = this.config.get<string>('EMAIL_VERIFICATION_URL');
    this.passwordResetUrl = this.config.get<string>('PASSWORD_RESET_URL');
  }

  async sendVerification(email: string, token: string) {
    const html = this.buildHtml({
      heading: 'Verify your email address',
      actionText: 'Verify Email',
      token,
      link: this.buildLink(this.verificationUrl, token),
    });
    await this.dispatchEmail({
      to: email,
      subject: 'Verify your email address',
      html,
      text: this.buildTextInstructions(token, this.verificationUrl),
    });
  }

  async sendPasswordReset(email: string, token: string) {
    const html = this.buildHtml({
      heading: 'Reset your password',
      actionText: 'Reset Password',
      token,
      link: this.buildLink(this.passwordResetUrl, token),
    });
    await this.dispatchEmail({
      to: email,
      subject: 'Password reset instructions',
      html,
      text: this.buildTextInstructions(token, this.passwordResetUrl),
    });
  }

  private async dispatchEmail(input: { to: string; subject: string; html: string; text: string }) {
    if (!this.apiKey || !this.fromAddress) {
      this.logger.warn('RESEND_API_KEY or EMAIL_FROM_ADDRESS missing; email will not be sent.');
      return;
    }
    const payload = {
      from: this.formatFrom(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    };
    const fetchFn = globalThis.fetch;
    if (!fetchFn) {
      throw new Error('Fetch API is not available in this runtime');
    }
    const response = await fetchFn(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      this.logger.error(
        {
          statusCode: response.status,
          from: payload.from,
        },
        `Failed to send email via Resend: ${errorBody}`,
      );

      const isProd = this.config.get<string>('NODE_ENV') === 'production';
      const detail = isProd
        ? 'Email delivery failed.'
        : `Email delivery failed (Resend ${response.status}). Check EMAIL_FROM_ADDRESS/EMAIL_FROM_NAME. Provider said: ${errorBody}`;

      throw new ProblemException(502, {
        title: 'Email delivery failed',
        detail,
        code: ErrorCode.INTERNAL,
      });
    }
  }

  private buildHtml(params: { heading: string; actionText: string; token: string; link?: string }) {
    const action = params.link
      ? `<p><a href="${params.link}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">${params.actionText}</a></p>`
      : `<p>Use the token below to ${params.actionText.toLowerCase()}:</p>`;
    return `
      <div style="font-family:Arial,sans-serif;line-height:1.6;">
        <h2>${params.heading}</h2>
        ${action}
        <p style="font-size:18px;"><strong>${params.token}</strong></p>
        <p>If you did not request this action, you can safely ignore this email.</p>
      </div>
    `;
  }

  private buildTextInstructions(token: string, link?: string) {
    if (link) {
      return `Follow this link to continue: ${link}\n\nToken: ${token}`;
    }
    return `Use this token to continue: ${token}`;
  }

  private buildLink(baseUrl: string | undefined, token: string) {
    if (!baseUrl) return undefined;
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('token', token);
      return url.toString();
    } catch {
      this.logger.warn(`Invalid URL configured for email link: ${baseUrl}`);
      return undefined;
    }
  }

  private formatFrom() {
    const address = (this.fromAddress ?? '').trim();
    const name = (this.fromName ?? '').trim();

    // Allow EMAIL_FROM_ADDRESS to already contain the full "Name <email@...>" format.
    // This avoids accidentally producing invalid strings like `Name <Name <email@...>>`.
    if (address.includes('<') && address.includes('>')) {
      return address;
    }

    if (name) {
      return `${name} <${address}>`;
    }

    return address;
  }
}

export const emailServiceProvider = {
  provide: EmailService,
  useFactory: (config: ConfigService, resend: ResendEmailService, mock: MockEmailService) => {
    return config.get<string>('RESEND_API_KEY') ? resend : mock;
  },
  inject: [ConfigService, ResendEmailService, MockEmailService],
};
