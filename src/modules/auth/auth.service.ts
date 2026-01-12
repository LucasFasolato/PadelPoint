import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName?: string;
  }) {
    const email = input.email.toLowerCase().trim();

    const exists = await this.users.findByEmail(email);
    if (exists) throw new BadRequestException('Email already in use');

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.users.create({
      email,
      passwordHash,
      role: UserRole.PLAYER,
      displayName: input.displayName?.trim() ?? null,
      active: true,
    });

    return this.issueToken(user.id, user.email, user.role);
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.toLowerCase().trim();

    const user = await this.users.findByEmail(email);
    if (!user || !user.active)
      throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueToken(user.id, user.email, user.role);
  }

  private issueToken(userId: string, email: string, role: string) {
    if (!process.env.JWT_SECRET) {
      // optional: remove once stable
      throw new Error('JWT_SECRET not loaded');
    }
    const payload = { sub: userId, email, role };
    const accessToken = this.jwt.sign(payload);
    return { accessToken };
  }
}
