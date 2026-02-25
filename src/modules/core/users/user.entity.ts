import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
} from 'typeorm';
import { UserRole } from './user-role.enum';
import { CompetitiveProfile } from '../competitive/competitive-profile.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  email!: string;

  @Column({ type: 'varchar', length: 120 })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.PLAYER })
  role!: UserRole;

  @Column({ type: 'varchar', length: 80, nullable: true })
  displayName!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToOne(() => CompetitiveProfile, (profile) => profile.user, {
    nullable: true,
  })
  competitiveProfile?: CompetitiveProfile;
}
