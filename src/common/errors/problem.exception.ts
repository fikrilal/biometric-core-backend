import { HttpException } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export class ProblemException extends HttpException {
  constructor(
    status: number,
    options: {
      title?: string;
      detail?: string;
      code?: ErrorCode | string;
      type?: string;
    } = {},
  ) {
    const { title, detail, code, type } = options;
    super({ title, detail, code, type }, status);
  }

  static notFound(detail?: string) {
    return new ProblemException(404, { title: 'Not Found', detail, code: ErrorCode.NOT_FOUND });
  }

  static conflict(detail?: string, code: ErrorCode | string = ErrorCode.CONFLICT) {
    return new ProblemException(409, { title: 'Conflict', detail, code });
  }
}

