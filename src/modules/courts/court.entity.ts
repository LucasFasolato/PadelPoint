import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Club } from '../clubs/club.entity';
import { Reservation } from '../reservations/reservation.entity';

@Entity({ name: 'courts' })
export class Court {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'varchar', length: 60 })
  superficie!: string;

  @Column('decimal', {
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number): number => value,
      from: (value: string): number => parseFloat(value),
    },
  })
  precioPorHora!: number;

  @Column({ type: 'boolean', default: true })
  activa!: boolean;

  @ManyToOne(() => Club, { nullable: false, onDelete: 'CASCADE' })
  club!: Club;

  // Useful for "Do not delete court if it has future reservations" logic later
  @OneToMany(() => Reservation, (res) => res.court)
  reservations!: Reservation[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
