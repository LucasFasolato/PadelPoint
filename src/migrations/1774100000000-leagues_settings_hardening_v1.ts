import { MigrationInterface, QueryRunner } from 'typeorm';

export class LeaguesSettingsHardeningV11774100000000
  implements MigrationInterface
{
  name = 'LeaguesSettingsHardeningV11774100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const defaults = JSON.stringify({
      winPoints: 3,
      drawPoints: 1,
      lossPoints: 0,
      tieBreakers: ['points', 'wins', 'setsDiff', 'gamesDiff'],
      includeSources: ['manual', 'reservation'],
    }).replace(/'/g, "''");

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'leagues'
            AND column_name = 'settings'
        ) THEN
          WITH defaults AS (
            SELECT '${defaults}'::jsonb AS value
          )
          UPDATE "leagues" l
          SET "settings" = (
            jsonb_build_object(
              'winPoints',
              COALESCE(l."settings"->'winPoints', defaults.value->'winPoints'),
              'drawPoints',
              COALESCE(l."settings"->'drawPoints', defaults.value->'drawPoints'),
              'lossPoints',
              COALESCE(l."settings"->'lossPoints', defaults.value->'lossPoints'),
              'tieBreakers',
              CASE
                WHEN jsonb_typeof(l."settings"->'tieBreakers') = 'array'
                  AND jsonb_array_length(l."settings"->'tieBreakers') > 0
                  THEN l."settings"->'tieBreakers'
                ELSE defaults.value->'tieBreakers'
              END,
              'includeSources',
              CASE
                WHEN jsonb_typeof(l."settings"->'includeSources') = 'array'
                  AND jsonb_array_length(l."settings"->'includeSources') > 0
                  THEN l."settings"->'includeSources'
                WHEN jsonb_typeof(l."settings"->'includeSources') = 'object'
                  THEN (
                    SELECT
                      COALESCE(
                        CASE
                          WHEN jsonb_array_length(picked.sources) > 0
                            THEN picked.sources
                          ELSE defaults.value->'includeSources'
                        END,
                        defaults.value->'includeSources'
                      )
                    FROM (
                      SELECT jsonb_agg(source ORDER BY ord) AS sources
                      FROM (
                        SELECT 'manual'::text AS source, 1 AS ord
                        WHERE (l."settings"->'includeSources'->'MANUAL') = 'true'::jsonb
                           OR (l."settings"->'includeSources'->'manual') = 'true'::jsonb
                        UNION ALL
                        SELECT 'reservation'::text AS source, 2 AS ord
                        WHERE (l."settings"->'includeSources'->'RESERVATION') = 'true'::jsonb
                           OR (l."settings"->'includeSources'->'reservation') = 'true'::jsonb
                      ) include_sources
                    ) picked
                  )
                ELSE defaults.value->'includeSources'
              END
            )
            || CASE
              WHEN l."settings" ? 'maxPlayers'
                THEN jsonb_build_object('maxPlayers', l."settings"->'maxPlayers')
              ELSE '{}'::jsonb
            END
            || CASE
              WHEN l."settings" ? 'scoringPreset'
                THEN jsonb_build_object('scoringPreset', l."settings"->'scoringPreset')
              ELSE '{}'::jsonb
            END
            || CASE
              WHEN l."settings" ? 'tieBreakPreset'
                THEN jsonb_build_object('tieBreakPreset', l."settings"->'tieBreakPreset')
              ELSE '{}'::jsonb
            END
            || CASE
              WHEN l."settings" ? 'allowLateJoin'
                THEN jsonb_build_object('allowLateJoin', l."settings"->'allowLateJoin')
              ELSE '{}'::jsonb
            END
          )
          FROM defaults
          WHERE l."settings" IS NULL
            OR l."settings" = '{}'::jsonb
            OR NOT (l."settings" ? 'winPoints')
            OR NOT (l."settings" ? 'drawPoints')
            OR NOT (l."settings" ? 'lossPoints')
            OR NOT (l."settings" ? 'tieBreakers')
            OR NOT (l."settings" ? 'includeSources')
            OR jsonb_typeof(l."settings"->'tieBreakers') <> 'array'
            OR jsonb_typeof(l."settings"->'includeSources') <> 'array';
        END IF;
      END $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible corrective backfill.
  }
}
