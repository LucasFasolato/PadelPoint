import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersAdminController } from './users-admin.controller';
import { UsersController } from './users.controller';
import { MeProfileController } from './me-profile.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController, UsersAdminController, MeProfileController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
