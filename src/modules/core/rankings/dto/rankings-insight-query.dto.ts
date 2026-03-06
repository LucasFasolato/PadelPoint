import { OmitType } from '@nestjs/swagger';
import { RankingsQueryDto } from './rankings-query.dto';

export class RankingsInsightQueryDto extends OmitType(RankingsQueryDto, [
  'page',
  'limit',
] as const) {}
