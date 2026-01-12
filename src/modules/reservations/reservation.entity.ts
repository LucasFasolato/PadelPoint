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
@Index(['court', 'startAt', 'endAt'])
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

  // sin auth por ahora → datos mínimos del cliente
  @Column({ type: 'varchar', length: 120 })
  clienteNombre!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  clienteEmail!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  clienteTelefono!: string | null;

  @Column('decimal', { precision: 10, scale: 2 })
  precio!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
