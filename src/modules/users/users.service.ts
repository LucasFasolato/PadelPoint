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
}
