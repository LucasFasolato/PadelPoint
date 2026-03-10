import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SetLeagueAvatarDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Existing media asset UUID. If provided, avatarUrl is resolved from the media asset.',
  })
  @IsOptional()
  @IsUUID()
  mediaAssetId?: string | null;

  @ApiPropertyOptional({
    description: 'Direct avatar URL (fallback when not using media assets)',
    example: 'https://res.cloudinary.com/demo/image/upload/v1/league.png',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(600)
  url?: string | null;

  @ApiPropertyOptional({
    description: 'Alias of url for compatibility with mobile clients',
    example: 'https://res.cloudinary.com/demo/image/upload/v1/league.png',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(600)
  avatarUrl?: string | null;
}
