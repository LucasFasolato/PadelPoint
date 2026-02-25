import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { MediaOwnerType } from '../media-owner-type.enum';
import { MediaKind } from '../media-kind.enum';

export class CreateSignatureDto {
  @IsEnum(MediaOwnerType)
  ownerType!: MediaOwnerType;

  @IsUUID()
  ownerId!: string;

  @IsEnum(MediaKind)
  kind!: MediaKind;

  // opcional: para gallery (poder subir varias)
  @IsOptional()
  @IsString()
  fileNameHint?: string;
}
