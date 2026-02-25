import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PaymentIntentStatus } from './enums/payment-intent-status.enum';
import { PaymentReferenceType } from './enums/payment-reference-type.enum';

@Entity('payment_intents')
@Index(['referenceType', 'referenceId'], { unique: true })
export class PaymentIntent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ✅ nullable para checkout público (guest)
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  // numeric => usar string en TS para no perder precisión
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 8, default: 'ARS' })
  currency!: string;

  @Column({
    type: 'enum',
    enum: PaymentIntentStatus,
    default: PaymentIntentStatus.PENDING,
  })
  status!: PaymentIntentStatus;

  @Column({ type: 'enum', enum: PaymentReferenceType })
  referenceType!: PaymentReferenceType;

  @Column({ type: 'uuid' })
  referenceId!: string;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
