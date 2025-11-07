import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipEnvelope } from '../common/http/decorators/skip-envelope.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  @SkipEnvelope()
  getHealth() {
    return { status: 'ok' };
  }
}
