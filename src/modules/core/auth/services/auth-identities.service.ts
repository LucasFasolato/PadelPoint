import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthIdentity } from '../entities/auth-identity.entity';
import { AuthIdentityResponseDto } from '../dto/auth-identity-response.dto';

@Injectable()
export class AuthIdentitiesService {
  constructor(
    @InjectRepository(AuthIdentity)
    private readonly identityRepo: Repository<AuthIdentity>,
  ) {}

  async listForUser(userId: string): Promise<AuthIdentityResponseDto[]> {
    const identities = await this.identityRepo.find({
      where: { userId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const canUnlink = identities.length > 1;

    return identities.map((identity) => ({
      id: identity.id,
      provider: identity.provider,
      email: identity.email,
      createdAt: identity.createdAt.toISOString(),
      canUnlink,
    }));
  }

  async unlinkForUser(userId: string, identityId: string): Promise<void> {
    const identity = await this.identityRepo.findOne({
      where: { id: identityId, userId },
    });

    if (!identity) {
      throw new NotFoundException('Identity not found');
    }

    const totalIdentities = await this.identityRepo.count({
      where: { userId },
    });

    if (totalIdentities <= 1) {
      throw new BadRequestException(
        'Cannot unlink the last remaining auth identity',
      );
    }

    await this.identityRepo.delete({ id: identityId, userId });
  }
}
