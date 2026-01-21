import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Court } from '../courts/court.entity';

export enum ReservationStatus {
  HOLD = 'hold',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'reservations' })
// ⚡ PERFORMANCE KEY: This Composite Index allows blazing fast Overlap Checks
// We include 'status' because we usually filter out cancelled reservations
@Index(['court', 'startAt', 'endAt', 'status'])
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Court, { nullable: false, onDelete: 'CASCADE' })
  court!: Court;

  @Column({ type: 'timestamptz' })
  startAt!: Date;

  @Column({ type: 'timestamptz' })
  endAt!: Date;

  @Column({
    type: 'enum',
    enum: ReservationStatus,
    default: ReservationStatus.HOLD,
  })
  status!: ReservationStatus;

  // solo para HOLD
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  // checkout público
  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  checkoutToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  checkoutTokenExpiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  // sin auth por ahora → datos mínimos del cliente
  @Column({ type: 'varchar', length: 120 })
  clienteNombre!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  clienteEmail!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  clienteTelefono!: string | null;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  precio!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
