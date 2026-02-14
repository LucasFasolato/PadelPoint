import { BadRequestException, PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

export class ParseRequiredUuidPipe implements PipeTransform<string, string> {
  constructor(private readonly paramName: string) {}

  transform(value: string): string {
    if (!value || value === 'undefined' || !isUUID(value, '4')) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_UUID_PARAM',
        message: `Invalid ${this.paramName}: must be a UUID`,
      });
    }

    return value;
  }
}
