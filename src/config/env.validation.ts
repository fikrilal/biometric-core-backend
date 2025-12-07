import { plainToInstance, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum WebauthnSignCountMode {
  Strict = 'strict',
  Lenient = 'lenient',
}

class EnvVars {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @Transform(({ value }) => (value !== undefined ? Number(value) : 3000))
  @IsInt()
  @Min(0)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @IsString()
  AUTH_JWT_ACCESS_SECRET!: string;

  @IsString()
  AUTH_JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  LOG_LEVEL?: string;

  @IsOptional()
  @IsString()
  RESEND_API_KEY?: string;

  @IsOptional()
  @IsString()
  EMAIL_FROM_ADDRESS?: string;

  @IsOptional()
  @IsString()
  EMAIL_FROM_NAME?: string;

  @IsOptional()
  @IsString()
  EMAIL_VERIFICATION_URL?: string;

  @IsOptional()
  @IsString()
  PASSWORD_RESET_URL?: string;

  // WebAuthn / Biometric configuration

  @IsOptional()
  @IsString()
  WEBAUTHN_RP_ID?: string;

  @IsOptional()
  @IsString()
  WEBAUTHN_RP_NAME?: string;

  /**
   * Comma-separated list of allowed origins for WebAuthn (e.g. https://app.example.com,https://localhost:3000).
   */
  @IsOptional()
  @IsString()
  WEBAUTHN_ORIGINS?: string;

  @Transform(({ value }) => (value !== undefined ? Number(value) : 180000))
  @IsInt()
  @Min(1000)
  WEBAUTHN_CHALLENGE_TTL_MS: number = 180000;

  @IsOptional()
  @IsEnum(WebauthnSignCountMode)
  WEBAUTHN_SIGNCOUNT_MODE: WebauthnSignCountMode = WebauthnSignCountMode.Strict;

  // Wallet & transfer configuration

  @Transform(({ value }) => (value !== undefined ? Number(value) : 1000))
  @IsInt()
  @Min(1)
  TRANSFER_MIN_AMOUNT_MINOR: number = 1000;

  @Transform(({ value }) => (value !== undefined ? Number(value) : 50_000_000))
  @IsInt()
  @Min(1)
  TRANSFER_MAX_AMOUNT_MINOR: number = 50_000_000;

  @Transform(({ value }) => (value !== undefined ? Number(value) : 200_000_000))
  @IsInt()
  @Min(1)
  TRANSFER_DAILY_LIMIT_MINOR: number = 200_000_000;

  @Transform(({ value }) => (value !== undefined ? Number(value) : 5_000_000))
  @IsInt()
  @Min(1)
  HIGH_VALUE_TRANSFER_THRESHOLD_MINOR: number = 5_000_000;
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.map((e) => JSON.stringify(e.constraints)).join(', '));
  }
  if (validated.RESEND_API_KEY && !validated.EMAIL_FROM_ADDRESS) {
    throw new Error('EMAIL_FROM_ADDRESS is required when RESEND_API_KEY is set');
  }
  if (validated.NODE_ENV !== NodeEnv.Test) {
    if (!validated.WEBAUTHN_RP_ID) {
      throw new Error('WEBAUTHN_RP_ID is required when NODE_ENV is not "test"');
    }
    if (!validated.WEBAUTHN_ORIGINS) {
      throw new Error('WEBAUTHN_ORIGINS is required when NODE_ENV is not "test"');
    }
  }
  return validated;
}
