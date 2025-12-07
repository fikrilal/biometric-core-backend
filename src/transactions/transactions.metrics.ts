import { Injectable, Logger } from '@nestjs/common';

export type StepUpRequiredReason = 'high_value' | 'daily_usage';

@Injectable()
export class TransactionsMetricsService {
  private readonly logger = new Logger(TransactionsMetricsService.name);

  private readonly counters = {
    created: 0,
    failed: 0,
    replayed: 0,
    stepUpRequired: 0,
    stepUpUsed: 0,
  };

  recordTransferCreated(payload: { amountMinor: number; currency: string; stepUpUsed: boolean }) {
    this.counters.created += 1;
    if (payload.stepUpUsed) {
      this.counters.stepUpUsed += 1;
    }
    this.logger.debug({
      event: 'transfer.metrics.created',
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      stepUpUsed: payload.stepUpUsed,
      totals: {
        created: this.counters.created,
        stepUpUsed: this.counters.stepUpUsed,
      },
    });
  }

  recordTransferFailed(reason: string | undefined) {
    this.counters.failed += 1;
    this.logger.debug({
      event: 'transfer.metrics.failed',
      reason: reason ?? 'unknown',
      totals: { failed: this.counters.failed },
    });
  }

  recordStepUpRequired(reason: StepUpRequiredReason) {
    this.counters.stepUpRequired += 1;
    this.logger.debug({
      event: 'transfer.metrics.step_up_required',
      reason,
      totals: { stepUpRequired: this.counters.stepUpRequired },
    });
  }

  recordTransferReplayed() {
    this.counters.replayed += 1;
    this.logger.debug({
      event: 'transfer.metrics.replayed',
      totals: { replayed: this.counters.replayed },
    });
  }
}
