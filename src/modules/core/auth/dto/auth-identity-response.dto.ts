import { ApiProperty } from '@nestjs/swagger';
import { AuthProvider } from '../enums/auth-provider.enum';

export class AuthIdentityResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: 'd5f5bdb8-4091-45c8-9db9-98f5565b0bf0',
  })
  id!: string;

  @ApiProperty({ enum: AuthProvider, enumName: 'AuthProvider' })
  provider!: AuthProvider;

  @ApiProperty({
    nullable: true,
    example: 'player@example.com',
  })
  email!: string | null;

  @ApiProperty({
    example: '2026-03-12T10:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description:
      'False only when this is the last remaining login identity for the account.',
    example: true,
  })
  canUnlink!: boolean;
}
