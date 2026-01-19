// src/club-members/entities/club-member.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Club } from '../clubs/club.entity';
import { ClubMemberRole } from './enums/club-member-role.enum';

@Entity('club_members')
@Index(['userId', 'clubId'], { unique: true })
export class ClubMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid' })
  clubId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne(() => Club, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clubId' })
  club!: Club;

  @Column({ type: 'enum', enum: ClubMemberRole, default: ClubMemberRole.STAFF })
  role!: ClubMemberRole;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
