import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.enum';

@Controller('auth')
export class AuthAdminBootstrapController {
  constructor(private readonly users: UsersService) {}

  @Post('bootstrap-admin')
  async bootstrap(@Body() body: { key: string; email: string }) {
    const expected = process.env.ADMIN_BOOTSTRAP_KEY;
    if (!expected) throw new ForbiddenException('Bootstrap disabled');
    if (body.key !== expected) throw new ForbiddenException('Invalid key');

    const email = body.email.toLowerCase().trim();
    const user = await this.users.findByEmail(email);
    if (!user) throw new ForbiddenException('User not found');

    await this.users.updateRole(user.id, UserRole.ADMIN);
    return { ok: true };
  }
}
