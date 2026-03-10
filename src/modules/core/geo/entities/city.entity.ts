import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Province } from './province.entity';
import { User } from '../../users/entities/user.entity';

@Index(
  'UQ_cities_provinceId_normalizedName',
  ['provinceId', 'normalizedName'],
  {
    unique: true,
  },
)
@Entity('cities')
export class City {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 160 })
  normalizedName!: string;

  @Index()
  @Column({ type: 'uuid' })
  provinceId!: string;

  @ManyToOne(() => Province, (province) => province.cities, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'provinceId' })
  province!: Province;

  @OneToMany(() => User, (user) => user.city)
  users?: User[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
