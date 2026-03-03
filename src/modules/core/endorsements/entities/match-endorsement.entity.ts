import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { MatchResult } from '@core/matches/entities/match-result.entity';
import { User } from '@core/users/entities/user.entity';
import { PlayerStrength } from '../enums/player-strength.enum';

@Entity('match_endorsements')
@Unique('UQ_match_endorsements_match_from_to', [
  'matchId',
  'fromUserId',
  'toUserId',
])
@Index('idx_match_endorsements_to_createdat', ['toUserId', 'createdAt'])
@Index('idx_match_endorsements_from_createdat', ['fromUserId', 'createdAt'])
@Index('idx_match_endorsements_matchid', ['matchId'])
export class MatchEndorsement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  matchId!: string;

  @ManyToOne(() => MatchResult, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'matchId' })
  match!: MatchResult;

  @Column({ type: 'uuid' })
  fromUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fromUserId' })
  fromUser!: User;

  @Column({ type: 'uuid' })
  toUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'toUserId' })
  toUser!: User;

  @Column({
    type: 'enum',
    enum: PlayerStrength,
    enumName: 'player_strength_enum',
    array: true,
  })
  strengths!: PlayerStrength[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
