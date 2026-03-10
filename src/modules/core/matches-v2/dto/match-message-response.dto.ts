import { ApiProperty } from '@nestjs/swagger';

export class MatchMessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  senderUserId!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
