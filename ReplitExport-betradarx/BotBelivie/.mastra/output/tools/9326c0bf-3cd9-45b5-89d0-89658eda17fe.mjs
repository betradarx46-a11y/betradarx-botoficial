import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import pg from 'pg';
import axios from 'axios';

const verifyGoalOutcomes = createTool({
  id: "verify-goal-outcomes",
  description: "Checks recent alerts and updates goal_happened status by comparing goal totals before/after alerts",
  inputSchema: z.object({}),
  outputSchema: z.object({
    checked: z.number(),
    updated: z.number(),
    success: z.boolean(),
    error: z.string().optional()
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [verifyGoalOutcomes] Starting execution");
    const connectionString = process.env.DATABASE_URL;
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!connectionString || !apiKey) {
      logger?.error("\u274C [verifyGoalOutcomes] Missing configuration", {
        hasDb: !!connectionString,
        hasApiKey: !!apiKey
      });
      return {
        checked: 0,
        updated: 0,
        success: false,
        error: "Missing DATABASE_URL or API_FOOTBALL_KEY"
      };
    }
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      const query = `
        SELECT id, fixture_id, minute, goals_at_alert, created_at
        FROM football_alerts
        WHERE goal_happened IS NULL
          AND created_at < NOW() - INTERVAL '10 minutes'
        ORDER BY created_at ASC
        LIMIT 50
      `;
      logger?.info("\u{1F50D} [verifyGoalOutcomes] Querying unverified alerts older than 10 minutes");
      const result = await client.query(query);
      const alerts = result.rows;
      logger?.info("\u{1F4CB} [verifyGoalOutcomes] Found unverified alerts", {
        count: alerts.length
      });
      let updated = 0;
      for (const alert of alerts) {
        try {
          const url = `https://v3.football.api-sports.io/fixtures?id=${alert.fixture_id}`;
          logger?.info("\u{1F4E1} [verifyGoalOutcomes] Fetching fixture data", {
            alertId: alert.id,
            fixtureId: alert.fixture_id
          });
          const response = await axios.get(url, {
            headers: { "x-apisports-key": apiKey },
            timeout: 1e4
          });
          if (response.data.response && response.data.response.length > 0) {
            const fixture = response.data.response[0];
            const goals = fixture.goals;
            const homeGoals = goals?.home || 0;
            const awayGoals = goals?.away || 0;
            const totalGoalsNow = homeGoals + awayGoals;
            const goalsAtAlert = alert.goals_at_alert || 0;
            const goalHappened = totalGoalsNow > goalsAtAlert;
            const updateQuery = `
              UPDATE football_alerts
              SET goal_happened = $1
              WHERE id = $2
            `;
            await client.query(updateQuery, [goalHappened, alert.id]);
            updated++;
            logger?.info("\u2705 [verifyGoalOutcomes] Updated alert", {
              alertId: alert.id,
              fixtureId: alert.fixture_id,
              goalsAtAlert,
              totalGoalsNow,
              goalHappened,
              goalIncrease: totalGoalsNow - goalsAtAlert
            });
          }
        } catch (error) {
          logger?.warn("\u26A0\uFE0F [verifyGoalOutcomes] Error checking fixture", {
            alertId: alert.id,
            fixtureId: alert.fixture_id,
            error: error.message
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      logger?.info("\u2705 [verifyGoalOutcomes] Completed verification", {
        checked: alerts.length,
        updated
      });
      return {
        checked: alerts.length,
        updated,
        success: true
      };
    } catch (error) {
      logger?.error("\u274C [verifyGoalOutcomes] Error verifying outcomes", {
        error: error.message
      });
      return {
        checked: 0,
        updated: 0,
        success: false,
        error: error.message || "Unknown error occurred"
      };
    } finally {
      await client.end();
    }
  }
});

export { verifyGoalOutcomes };
//# sourceMappingURL=9326c0bf-3cd9-45b5-89d0-89658eda17fe.mjs.map
