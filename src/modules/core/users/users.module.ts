import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './services/users.service';
import { UsersAdminController } from './controllers/users-admin.controller';
import { UsersController } from './controllers/users.controller';
import { MeProfileController } from './controllers/me-profile.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController, UsersAdminController, MeProfileController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
