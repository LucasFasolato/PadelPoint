import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Court } from './court.entity';
import { Club } from '../clubs/club.entity';
import { CourtsController } from './courts.controller';
import { CourtsService } from './courts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Court, Club])],
  controllers: [CourtsController],
  providers: [CourtsService],
})
export class CourtsModule {}
