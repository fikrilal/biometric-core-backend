import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponse } from './dto/transfer.response';
import { ResolveRecipientDto, ResolveRecipientResponse } from './dto/resolve-recipient.dto';

@ApiTags('Transactions')
@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post('transfer')
  @ApiOperation({ summary: 'Create internal transfer' })
  async createTransfer(
    @CurrentUser() user: FastifyRequest['user'],
    @Body() dto: CreateTransferDto,
    @Headers('x-step-up-token') stepUpToken?: string,
  ): Promise<TransferResponse> {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    return this.transactions.createTransfer(
      user.userId,
      dto,
      { headerToken: stepUpToken, token: dto.stepUpToken },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transfer by id' })
  getTransfer(
    @CurrentUser() user: FastifyRequest['user'],
    @Param('id') id: string,
  ): Promise<TransferResponse> {
    if (!user) {
      throw new Error('Missing authenticated user in request');
    }
    return this.transactions.getTransactionForUser(user.userId, id);
  }

  @Post('recipients/resolve')
  @ApiOperation({ summary: 'Resolve recipient identifier prior to transfer' })
  resolveRecipient(@Body() dto: ResolveRecipientDto): Promise<ResolveRecipientResponse> {
    return this.transactions.resolveRecipient(dto);
  }
}
