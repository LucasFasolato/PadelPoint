import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ILike } from 'typeorm';
import { UserRole } from './user-role.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<User>) {
    const ent = this.repo.create(data);
    return this.repo.save(ent);
  }

  async searchByEmail(email: string) {
    const q = email.trim().toLowerCase();
    return this.repo.find({
      where: { email: ILike(`%${q}%`) },
      order: { createdAt: 'DESC' },
      take: 20,
      select: ['id', 'email', 'role', 'displayName', 'active', 'createdAt'],
    });
  }

  async updateRole(userId: string, role: UserRole) {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Seguridad extra: no permitir poner ADMIN a un usuario inactivo
    if (!user.active && role === UserRole.ADMIN) {
      throw new BadRequestException('Cannot promote an inactive user to ADMIN');
    }

    user.role = role;
    await this.repo.save(user);

    return {
      ok: true,
      userId: user.id,
      email: user.email,
      role: user.role,
    };
  }

  async getPlayerProfile(userId: string) {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return this.toPlayerProfile(user);
  }

  async updatePlayerProfile(
    userId: string,
    input: { displayName?: string; phone?: string },
  ) {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (input.displayName !== undefined) {
      const name = input.displayName.trim();
      if (name.length < 2 || name.length > 50) {
        throw new BadRequestException('displayName inválido');
      }
      user.displayName = name;
    }

    if (input.phone !== undefined) {
      const phone = input.phone.trim();
      if (
        phone.length < 7 ||
        phone.length > 20 ||
        !/^[+0-9\s-]+$/.test(phone)
      ) {
        throw new BadRequestException('phone inválido');
      }
      user.phone = phone;
    }

    const saved = await this.repo.save(user);
    return this.toPlayerProfile(saved);
  }

  private toPlayerProfile(user: User) {
    return {
      userId: user.id,
      email: user.email,
      role: 'PLAYER',
      displayName: user.displayName ?? null,
      phone: user.phone ?? null,
      createdAt: user.createdAt ? user.createdAt.toISOString() : null,
    };
  }
}
