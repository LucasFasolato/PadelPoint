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
import { Country } from './country.entity';
import { City } from './city.entity';

@Entity('provinces')
export class Province {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 16, nullable: true })
  code!: string | null;

  @Index()
  @Column({ type: 'uuid' })
  countryId!: string;

  @ManyToOne(() => Country, (country) => country.provinces, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'countryId' })
  country!: Country;

  @OneToMany(() => City, (city) => city.province)
  cities?: City[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
