import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, ILike } from 'typeorm';
import { User } from './user.entity';
import { UserRole } from './user-role.enum';

// DTO para la búsqueda competitive
export interface UserSearchResult {
  userId: string;
  email: string;
  displayName: string;
  elo: number | null;
  category: number | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  /**
   * Búsqueda para el módulo competitive
   * Busca por email o displayName, excluye al usuario actual
   */
  async searchForCompetitive(
    query: string,
    excludeUserId: string,
  ): Promise<UserSearchResult[]> {
    const q = query.trim().toLowerCase();

    const users = await this.repo.find({
      where: [
        {
          email: ILike(`%${q}%`),
          id: Not(excludeUserId),
          active: true,
        },
        {
          displayName: ILike(`%${q}%`),
          id: Not(excludeUserId),
          active: true,
        },
      ],
      relations: ['competitiveProfile'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return users.map((u) => ({
      userId: u.id,
      email: u.email,
      displayName: u.displayName || u.email.split('@')[0],
      elo: u.competitiveProfile?.elo ?? null,
      category: u.competitiveProfile
        ? this.calculateCategory(u.competitiveProfile.elo)
        : null,
    }));
  }

  /**
   * Calcular categoría basada en ELO
   * 1ra: 1800+
   * 2da: 1600-1799
   * 3ra: 1400-1599
   * 4ta: 1200-1399
   * 5ta: 1000-1199
   * 6ta: 800-999
   * 7ma: 600-799
   * 8va: <600
   */
  private calculateCategory(elo: number): number {
    if (elo >= 1800) return 1;
    if (elo >= 1600) return 2;
    if (elo >= 1400) return 3;
    if (elo >= 1200) return 4;
    if (elo >= 1000) return 5;
    if (elo >= 800) return 6;
    if (elo >= 600) return 7;
    return 8;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<User>): Promise<User> {
    const ent = this.repo.create(data);
    return this.repo.save(ent);
  }

  async searchByEmail(email: string): Promise<Partial<User>[]> {
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
