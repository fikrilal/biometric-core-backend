import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { WalletsService } from './wallets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WalletResponse } from './dto/wallet.response';
import { PageQueryDto } from '../common/pagination/page-query.dto';

@ApiTags('wallets')
@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user wallet' })
  getWallet(@CurrentUser() user: FastifyRequest['user']): Promise<WalletResponse> {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    return this.wallets.getWalletView(user.userId);
  }

  @Get('me/transactions')
  @ApiOperation({ summary: 'List wallet transactions for current user' })
  getTransactions(
    @CurrentUser() user: FastifyRequest['user'],
    @Query() query: PageQueryDto,
  ) {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    return this.wallets.getTransactionsForUser(user.userId, query.cursor, query.limit);
  }
}
