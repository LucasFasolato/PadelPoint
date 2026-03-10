import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import type { PlayerPlayStyleTag } from '../utils/player-profile.constants';

export type PlayerLookingFor = {
  partner: boolean;
  rival: boolean;
};

export type PlayerLocation = {
  city: string | null;
  province: string | null;
  country: string | null;
};

@Entity('player_profiles')
export class PlayerProfile {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 240, nullable: true })
  bio!: string | null;

  @Column({ type: 'jsonb', nullable: false, default: () => "'[]'::jsonb" })
  playStyleTags!: PlayerPlayStyleTag[];

  @Column({ type: 'jsonb', nullable: false, default: () => "'[]'::jsonb" })
  strengths!: string[];

  @Column({
    type: 'jsonb',
    nullable: false,
    default: () => '\'{"partner":false,"rival":false}\'::jsonb',
  })
  lookingFor!: PlayerLookingFor;

  @Column({ type: 'jsonb', nullable: true })
  location!: PlayerLocation | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
