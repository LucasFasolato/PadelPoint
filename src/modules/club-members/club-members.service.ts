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

  // 1. List Members (Used by Frontend)
  async findAllByClub(clubId: string) {
    return this.repo.find({
      where: { clubId }, // Using clubId directly is usually safer/faster
      relations: ['user'], // Essential: Load user to get email/name
      order: { createdAt: 'ASC' },
    });
  }

  // 2. Create/Invite Member (Used by Frontend)
  async create(clubId: string, email: string, role: string) {
    const cleanEmail = email.toLowerCase().trim();

    // Check if user exists in the platform
    const user = await this.users.findByEmail(cleanEmail);
    if (!user) throw new NotFoundException('User not found in PadelPoint');

    // Convert string to Enum
    const roleEnum =
      role === 'ADMIN' ? ClubMemberRole.ADMIN : ClubMemberRole.STAFF;

    return this.upsertMember({
      userId: user.id,
      clubId,
      role: roleEnum,
    });
  }

  // Helper for Create/Update
  private async upsertMember(input: {
    userId: string;
    clubId: string;
    role: ClubMemberRole;
  }) {
    const existing = await this.repo.findOne({
      where: { userId: input.userId, clubId: input.clubId },
    });

    if (existing) {
      existing.role = input.role;
      existing.active = true; // Re-activate if they were removed
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

  // 3. Remove/Update Member (Logic to protect last Admin)
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

    // Rule: Cannot disable/demote the last ADMIN
    const wantsToDemoteOrRemove =
      (input.role &&
        input.role !== ClubMemberRole.ADMIN &&
        member.role === ClubMemberRole.ADMIN) ||
      (input.active === false && member.role === ClubMemberRole.ADMIN);

    if (wantsToDemoteOrRemove) {
      const adminCount = await this.repo.count({
        where: {
          clubId: input.clubId,
          role: ClubMemberRole.ADMIN,
          active: true,
        },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot remove the last club admin');
      }
    }

    if (input.role) member.role = input.role;
    if (typeof input.active === 'boolean') member.active = input.active;

    return this.repo.save(member);
  }
}
