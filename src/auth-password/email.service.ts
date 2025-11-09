import { Injectable } from '@nestjs/common';

@Injectable()
export class MockEmailService {
  async sendVerification(email: string, token: string) {
    // TODO: integrate real provider. For now, log for testing.
    console.log(`[email] verification token for ${email}: ${token}`);
  }

  async sendPasswordReset(email: string, token: string) {
    console.log(`[email] password reset token for ${email}: ${token}`);
  }
}
