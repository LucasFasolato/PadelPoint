import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ClubMember } from './club-member.entity';
import { ClubMemberRole } from './enums/club-member-role.enum';
import { UsersService } from '../users/users.service';

@Injectable()
export class ClubMembersService {
  constructor(
    @InjectRepository(ClubMember)
    private readonly repo: Repository<ClubMember>,
    private readonly users: UsersService,
  ) {}

  async listMembers(clubId: string) {
    const members = await this.repo.find({
      where: { clubId },
      relations: ['user'], // para devolver email/displayName
      order: { createdAt: 'ASC' },
    });

    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      displayName: m.user.displayName,
      role: m.role,
      active: m.active,
      createdAt: m.createdAt,
    }));
  }

  async addMemberByEmail(input: {
    clubId: string;
    email: string;
    role: ClubMemberRole;
  }) {
    const email = input.email.toLowerCase().trim();
    const user = await this.users.findByEmail(email);
    if (!user) throw new NotFoundException('User not found');

    return this.upsertMember({
      userId: user.id,
      clubId: input.clubId,
      role: input.role,
    });
  }

  async upsertMember(input: {
    userId: string;
    clubId: string;
    role: ClubMemberRole;
  }) {
    const existing = await this.repo.findOne({
      where: { userId: input.userId, clubId: input.clubId },
    });

    if (existing) {
      existing.role = input.role;
      existing.active = true;
      return this.repo.save(existing);
    }

    const created = this.repo.create({
      userId: input.userId,
      clubId: input.clubId,
      role: input.role,
      active: true,
    });

    return this.repo.save(created);
  }

  async updateMember(input: {
    clubId: string;
    userId: string;
    role?: ClubMemberRole;
    active?: boolean;
  }) {
    const member = await this.repo.findOne({
      where: { clubId: input.clubId, userId: input.userId },
    });
    if (!member) throw new NotFoundException('Membership not found');

    // regla pro: evitar que se desactive el último ADMIN del club
    const wantsToRemoveAdmin =
      (input.role &&
        input.role !== ClubMemberRole.ADMIN &&
        member.role === ClubMemberRole.ADMIN) ||
      (typeof input.active === 'boolean' &&
        input.active === false &&
        member.role === ClubMemberRole.ADMIN);

    if (wantsToRemoveAdmin) {
      const admins = await this.repo.count({
        where: {
          clubId: input.clubId,
          role: ClubMemberRole.ADMIN,
          active: true,
        },
      });
      if (admins <= 1)
        throw new BadRequestException('Cannot remove the last club admin');
    }

    if (input.role) member.role = input.role;
    if (typeof input.active === 'boolean') member.active = input.active;

    return this.repo.save(member);
  }
}
