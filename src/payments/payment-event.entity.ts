import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('payment_events')
@Index(['paymentIntentId', 'createdAt'])
export class PaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  paymentIntentId!: string;

  @Column({ type: 'varchar', length: 64 })
  type!: string; // CREATED | SUCCESS | FAILED | EXPIRED | CANCELLED

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
