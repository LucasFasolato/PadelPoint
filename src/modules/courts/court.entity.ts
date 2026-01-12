import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Club } from '../clubs/club.entity';

@Entity({ name: 'courts' })
export class Court {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'varchar', length: 60 })
  superficie!: string;

  @Column('decimal', { precision: 10, scale: 2 })
  precioPorHora!: number;

  @Column({ type: 'boolean', default: true })
  activa!: boolean;

  @ManyToOne(() => Club, { nullable: false, onDelete: 'CASCADE' })
  club!: Club;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
