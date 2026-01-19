import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MediaOwnerType } from './media-owner-type.enum';
import { MediaKind } from './media-kind.enum';
import { MediaProvider } from './media-provider.enum';

@Entity('media_assets')
@Index(['ownerType', 'ownerId', 'kind', 'active'])
export class MediaAsset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: MediaOwnerType })
  ownerType!: MediaOwnerType;

  @Column({ type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'enum', enum: MediaKind })
  kind!: MediaKind;

  @Column({
    type: 'enum',
    enum: MediaProvider,
    default: MediaProvider.CLOUDINARY,
  })
  provider!: MediaProvider;

  @Column({ type: 'varchar', length: 220 })
  publicId!: string;

  @Column({ type: 'varchar', length: 600 })
  url!: string;

  @Column({ type: 'varchar', length: 600 })
  secureUrl!: string;

  @Column({ type: 'int', nullable: true })
  bytes!: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  format!: string | null;

  @Column({ type: 'int', nullable: true })
  width!: number | null;

  @Column({ type: 'int', nullable: true })
  height!: number | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
