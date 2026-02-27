import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { UserNotification } from '../../notifications/entities/user-notification.entity';
import { UserNotificationType } from '../../notifications/enums/user-notification-type.enum';
import { RankingScope } from '../enums/ranking-scope.enum';
import { RankingTimeframe } from '../enums/ranking-timeframe.enum';
import { RankingMode } from '../enums/ranking-mode.enum';
import { RankingSnapshotRun } from '../entities/ranking-snapshot-run.entity';
import { RankingsService } from './rankings.service';

type SnapshotScopeTarget = {
  scope: RankingScope;
  provinceCode?: string | null;
  cityId?: string | null;
};

export type RankingSnapshotBatchInput = {
  scope?: string;
  provinceCode?: string;
  cityId?: string;
  category?: string;
  timeframe?: string;
  mode?: string;
  asOfDate?: string;
};

export type RankingSnapshotBatchSummary = {
  runId: string;
  trigger: 'SCHEDULED' | 'MANUAL';
  candidates: number;
  insertedSnapshots: number;
  computedRows: number;
  movementEvents: number;
  durationMs: number;
  asOfDate: string;
  scope: string | null;
  category: string;
  timeframe: RankingTimeframe;
  mode: RankingMode;
};

const DEFAULT_TIMEZONE = process.env.RANKINGS_SNAPSHOT_TZ ?? 'America/Argentina/Cordoba';

@Injectable()
export class RankingsSnapshotSchedulerService {
  private readonly logger = new Logger(RankingsSnapshotSchedulerService.name);

  constructor(
    private readonly rankingsService: RankingsService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserNotification)
    private readonly notificationsRepo: Repository<UserNotification>,
    @InjectRepository(RankingSnapshotRun)
    private readonly runsRepo: Repository<RankingSnapshotRun>,
  ) {}

  @Cron('0 0 3 * * *', {
    name: 'global-rankings-snapshot-daily',
    timeZone: DEFAULT_TIMEZONE,
  })
  async runScheduledSnapshots(): Promise<void> {
    await this.runBatch({}, 'SCHEDULED');
  }

  async runManual(input: RankingSnapshotBatchInput): Promise<RankingSnapshotBatchSummary> {
    return this.runBatch(input, 'MANUAL');
  }

  private async runBatch(
    input: RankingSnapshotBatchInput,
    trigger: 'SCHEDULED' | 'MANUAL',
  ): Promise<RankingSnapshotBatchSummary> {
    const startedAtMs = Date.now();
    const scope = input.scope
      ? this.rankingsService.parseScope(input.scope)
      : null;
    const timeframe = this.rankingsService.parseTimeframe(input.timeframe);
    const mode = this.rankingsService.parseMode(input.mode);
    const { categoryKey, categoryNumber } = this.rankingsService.parseCategory(
      input.category,
    );
    const asOfDate = this.parseAsOfDate(input.asOfDate);
    const asOfDateBucket = asOfDate.toISOString().slice(0, 10);

    const targets = scope
      ? [
          {
            scope,
            provinceCode: input.provinceCode ?? null,
            cityId: input.cityId ?? null,
          } satisfies SnapshotScopeTarget,
        ]
      : await this.listDefaultScopeTargets();

    const run = await this.runsRepo.save(
      this.runsRepo.create({
        trigger,
        status: 'RUNNING',
        scope: scope ?? null,
        provinceCode: input.provinceCode?.trim().toUpperCase() ?? null,
        cityId: input.cityId?.trim() ?? null,
        categoryKey,
        timeframe,
        modeKey: mode,
        asOfDate: asOfDateBucket,
        finishedAt: null,
        metadata: null,
      }),
    );

    let computedRows = 0;
    let insertedSnapshots = 0;
    let movementEvents = 0;

    try {
      for (const target of targets) {
        const result = await this.rankingsService.createGlobalRankingSnapshotDetailed({
          scope: target.scope,
          provinceCode: target.provinceCode,
          cityId: target.cityId,
          categoryKey,
          categoryNumber,
          timeframe,
          modeKey: mode,
          asOfDate,
        });

        computedRows += result.computedRows;
        if (result.inserted) {
          insertedSnapshots += 1;
          movementEvents += result.movementEvents;
        }
      }

      if (insertedSnapshots > 0) {
        await this.notificationsRepo.insert({
          userId: null,
          type: UserNotificationType.RANKING_SNAPSHOT_PUBLISHED,
          title: 'Ranking snapshots published',
          body: `${insertedSnapshots} snapshot(s) generated`,
          data: {
            runId: run.id,
            trigger,
            insertedSnapshots,
            movementEvents,
            computedRows,
            candidates: targets.length,
            scope: scope ?? 'ALL',
            category: categoryKey,
            timeframe,
            mode,
            asOfDate: asOfDateBucket,
          },
          readAt: null,
        });
      }

      const durationMs = Date.now() - startedAtMs;
      await this.runsRepo.update(run.id, {
        status: 'SUCCESS',
        candidates: targets.length,
        computedRows,
        insertedSnapshots,
        movementEvents,
        durationMs,
        finishedAt: new Date(),
        error: null,
        metadata: {
          timezone: DEFAULT_TIMEZONE,
        },
      });

      this.logger.log(
        `snapshot batch summary: trigger=${trigger} runId=${run.id} candidates=${targets.length} computedRows=${computedRows} inserted=${insertedSnapshots} movements=${movementEvents} durationMs=${durationMs}`,
      );

      return {
        runId: run.id,
        trigger,
        candidates: targets.length,
        insertedSnapshots,
        computedRows,
        movementEvents,
        durationMs,
        asOfDate: asOfDateBucket,
        scope: scope ?? 'ALL',
        category: categoryKey,
        timeframe,
        mode,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAtMs;
      const message = err instanceof Error ? err.message : String(err);
      await this.runsRepo.update(run.id, {
        status: 'FAILED',
        candidates: targets.length,
        computedRows,
        insertedSnapshots,
        movementEvents,
        durationMs,
        finishedAt: new Date(),
        error: message,
      });

      this.logger.error(
        `snapshot batch failed: trigger=${trigger} runId=${run.id} candidates=${targets.length} computedRows=${computedRows} inserted=${insertedSnapshots} movements=${movementEvents} durationMs=${durationMs} error=${message}`,
      );

      throw err;
    }
  }

  private parseAsOfDate(value?: string): Date {
    if (!value) return new Date();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_AS_OF_DATE',
        message: 'asOfDate must be a valid ISO date string',
      });
    }
    return date;
  }

  private async listDefaultScopeTargets(): Promise<SnapshotScopeTarget[]> {
    const targets: SnapshotScopeTarget[] = [{ scope: RankingScope.COUNTRY }];

    const provinceRows = await this.userRepo
      .createQueryBuilder('u')
      .innerJoin('u.competitiveProfile', 'cp')
      .innerJoin('u.city', 'city')
      .innerJoin('city.province', 'province')
      .select('DISTINCT UPPER(TRIM(province.code))', 'provinceCode')
      .where('cp."matchesPlayed" > 0')
      .andWhere('province.code IS NOT NULL')
      .getRawMany<{ provinceCode: string }>();

    for (const row of provinceRows) {
      if (!row.provinceCode) continue;
      targets.push({
        scope: RankingScope.PROVINCE,
        provinceCode: row.provinceCode,
      });
    }

    const cityRows = await this.userRepo
      .createQueryBuilder('u')
      .innerJoin('u.competitiveProfile', 'cp')
      .select('DISTINCT u."cityId"', 'cityId')
      .where('cp."matchesPlayed" > 0')
      .andWhere('u."cityId" IS NOT NULL')
      .getRawMany<{ cityId: string }>();

    for (const row of cityRows) {
      if (!row.cityId) continue;
      targets.push({
        scope: RankingScope.CITY,
        cityId: row.cityId,
      });
    }

    return targets;
  }
}
