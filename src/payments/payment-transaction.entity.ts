import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { PaymentProvider } from './enums/payment-provider.enum';
import { PaymentTransactionStatus } from './enums/payment-transaction-status.enum';
import { PaymentIntent } from './payment-intent.entity';

@Entity('payment_transactions')
@Index(['paymentIntentId', 'createdAt'])
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  paymentIntentId!: string;

  @ManyToOne(() => PaymentIntent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paymentIntentId' })
  paymentIntent!: PaymentIntent;

  @Column({
    type: 'enum',
    enum: PaymentProvider,
    default: PaymentProvider.SIMULATED,
  })
  provider!: PaymentProvider;

  @Column({ type: 'varchar', length: 128, nullable: true })
  providerRef!: string | null;

  @Column({
    type: 'enum',
    enum: PaymentTransactionStatus,
    default: PaymentTransactionStatus.INITIATED,
  })
  status!: PaymentTransactionStatus;

  @Column({ type: 'jsonb', nullable: true })
  rawResponse!: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
