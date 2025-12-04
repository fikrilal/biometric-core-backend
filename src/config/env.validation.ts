import { plainToInstance, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
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
  return validated;
}
