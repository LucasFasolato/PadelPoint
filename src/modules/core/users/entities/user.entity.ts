import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserRole } from '../enums/user-role.enum';
import { CompetitiveProfile } from '@core/competitive/entities/competitive-profile.entity';
import { City } from '../../geo/entities/city.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  email!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.PLAYER })
  role!: UserRole;

  @Column({ type: 'varchar', length: 80, nullable: true })
  displayName!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  cityId!: string | null;

  @ManyToOne(() => City, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cityId' })
  city!: City | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToOne(() => CompetitiveProfile, (profile) => profile.user, {
    nullable: true,
  })
  competitiveProfile?: CompetitiveProfile;
}
