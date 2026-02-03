import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type EventLogPayload = Record<string, unknown>;

@Entity('event_logs')
export class EventLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  type!: string;

  @Column({ type: 'jsonb', nullable: true })
  payload!: EventLogPayload | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
