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

@Entity({ name: 'court_availability_overrides' })
@Index(['court', 'fecha', 'horaInicio', 'horaFin'])
export class CourtAvailabilityOverride {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Court, { nullable: false, onDelete: 'CASCADE' })
  court!: Court;

  // YYYY-MM-DD
  @Column({ type: 'date' })
  fecha!: string;

  // 'HH:MM' (Postgres time)
  @Column({ type: 'time' })
  horaInicio!: string;

  @Column({ type: 'time' })
  horaFin!: string;

  // true = bloquea slots, false = abre slots (por si querés abrir excepciones en el futuro)
  @Column({ type: 'boolean', default: true })
  bloqueado!: boolean;

  @Column({ type: 'varchar', length: 200, nullable: true })
  motivo!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
