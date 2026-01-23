import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Court } from '../courts/court.entity';

@Entity({ name: 'court_availability_rules' })
@Index(
  'UQ_rule_court_day_start_end_slot',
  ['court', 'diaSemana', 'horaInicio', 'horaFin', 'slotMinutos'],
  { unique: true },
)
export class CourtAvailabilityRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Court, { nullable: false, onDelete: 'CASCADE' })
  court!: Court;

  // 0=domingo ... 6=sábado (igual que Postgres EXTRACT(DOW))
  @Column({ type: 'int' })
  diaSemana!: number;

  // 'HH:MM'
  @Column({ type: 'varchar', length: 5 })
  horaInicio!: string;

  // 'HH:MM'
  @Column({ type: 'varchar', length: 5 })
  horaFin!: string;

  // duración de cada turno (ej 60 min, 90 min)
  @Column({ type: 'int', default: 60 })
  slotMinutos!: number;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
