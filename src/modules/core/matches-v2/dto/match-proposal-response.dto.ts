import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChallengeScheduleProposalStatus } from '../../challenges/enums/challenge-schedule-proposal-status.enum';

export class MatchProposalResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  proposedByUserId!: string;

  @ApiProperty({ format: 'date-time' })
  scheduledAt!: string;

  @ApiPropertyOptional({ nullable: true })
  locationLabel!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  clubId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  courtId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiProperty({ enum: ChallengeScheduleProposalStatus })
  status!: ChallengeScheduleProposalStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
