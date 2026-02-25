import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
} from 'class-validator';
import { MediaOwnerType } from '../media-owner-type.enum';
import { MediaKind } from '../media-kind.enum';

export class RegisterMediaDto {
  @IsEnum(MediaOwnerType)
  ownerType!: MediaOwnerType;

  @IsUUID()
  ownerId!: string;

  @IsEnum(MediaKind)
  kind!: MediaKind;

  @IsString()
  publicId!: string;

  @IsUrl()
  url!: string;

  @IsUrl()
  secureUrl!: string;

  @IsOptional()
  @IsInt()
  bytes?: number;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsInt()
  width?: number;

  @IsOptional()
  @IsInt()
  height?: number;
}
