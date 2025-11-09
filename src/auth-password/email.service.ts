import { Injectable } from '@nestjs/common';

@Injectable()
export class MockEmailService {
  private static verificationTokens = new Map<string, string[]>();
  private static resetTokens = new Map<string, string[]>();

  async sendVerification(email: string, token: string) {
    MockEmailService.storeToken(MockEmailService.verificationTokens, email, token);
    // TODO: integrate real provider. For now, log for testing.
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
