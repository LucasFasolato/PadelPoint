import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClubMember } from '../club-members/club-member.entity';

@Entity({ name: 'clubs' })
@Index(['email'], { unique: true })
export class Club {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'varchar', length: 200 })
  direccion!: string;

  @Column({ type: 'varchar', length: 30 })
  telefono!: string;

  @Column({ type: 'varchar', length: 160 })
  email!: string;

  // Para mapas, opcional
  @Column('decimal', { precision: 10, scale: 7, nullable: true })
  latitud!: number | null;

  @Column('decimal', { precision: 10, scale: 7, nullable: true })
  longitud!: number | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @OneToMany(() => ClubMember, (member) => member.club)
  members: ClubMember[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
