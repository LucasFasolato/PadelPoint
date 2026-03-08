import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateChallengeMessageDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  message!: string;
}
