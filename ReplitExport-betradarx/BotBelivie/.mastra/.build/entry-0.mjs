import { Mastra } from '@mastra/core';
import { MastraError } from '@mastra/core/error';
import { PinoLogger } from '@mastra/loggers';
import { MastraLogger, LogLevel } from '@mastra/core/logger';
import pino from 'pino';
import { MCPServer } from '@mastra/mcp';
import { Inngest, NonRetriableError } from 'inngest';
import { z } from 'zod';
import { PostgresStore } from '@mastra/pg';
import { realtimeMiddleware } from '@inngest/realtime';
import { serve, init } from '@mastra/inngest';
import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createTool } from '@mastra/core/tools';
import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';
import pg from 'pg';

const sharedPostgresStorage = new PostgresStore({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/mastra"
});

const inngest = new Inngest(
  process.env.NODE_ENV === "production" ? {
    id: "replit-agent-workflow",
    name: "Replit Agent Workflow System"
  } : {
    id: "mastra",
    baseUrl: "http://localhost:3000",
    isDev: true,
    middleware: [realtimeMiddleware()]
  }
);

const {
  createWorkflow: originalCreateWorkflow,
  createStep} = init(inngest);
function createWorkflow(params) {
  return originalCreateWorkflow({
    ...params,
    retryConfig: {
      attempts: process.env.NODE_ENV === "production" ? 3 : 0,
      ...params.retryConfig ?? {}
    }
  });
}
const inngestFunctions = [];
function registerCronWorkflow(cronExpression, workflow) {
  const f = inngest.createFunction(
    { id: "cron-trigger" },
    [{ event: "replit/cron.trigger" }, { cron: cronExpression }],
    async ({ event, step }) => {
      const run = await workflow.createRunAsync();
      const result = await run.start({ inputData: {} });
      return result;
    }
  );
  inngestFunctions.push(f);
}
function inngestServe({
  mastra,
  inngest: inngest2
}) {
  let serveHost = void 0;
  if (process.env.NODE_ENV === "production") {
    if (process.env.REPLIT_DOMAINS) {
      serveHost = `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`;
    }
  } else {
    serveHost = "http://localhost:5000";
  }
  return serve({
    mastra,
    inngest: inngest2,
    functions: inngestFunctions,
    registerOptions: { serveHost }
  });
}

const fetchLiveFixtures = createTool({
  id: "fetch-live-fixtures",
  description: "Fetches all currently live football matches from API-Football",
  inputSchema: z.object({}),
  outputSchema: z.object({
    fixtures: z.array(z.any()),
    count: z.number(),
    success: z.boolean(),
    error: z.string().optional()
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [fetchLiveFixtures] Starting execution");
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      logger?.error("\u274C [fetchLiveFixtures] API_FOOTBALL_KEY not found in environment");
      return {
        fixtures: [],
        count: 0,
        success: false,
        error: "API_FOOTBALL_KEY not configured"
      };
    }
    try {
      const url = "https://v3.football.api-sports.io/fixtures?live=all";
      logger?.info("\u{1F4E1} [fetchLiveFixtures] Calling API-Football", { url });
      const response = await axios.get(url, {
        headers: { "x-apisports-key": apiKey },
        timeout: 15e3
      });
      if (response.status !== 200) {
        logger?.error("\u274C [fetchLiveFixtures] API returned non-200 status", {
          status: response.status,
          data: response.data
        });
        return {
          fixtures: [],
          count: 0,
          success: false,
          error: `API returned status ${response.status}`
        };
      }
      const fixtures = response.data.response || [];
      logger?.info("\u2705 [fetchLiveFixtures] Successfully fetched fixtures", {
        count: fixtures.length
      });
      return {
        fixtures,
        count: fixtures.length,
        success: true
      };
    } catch (error) {
      logger?.error("\u274C [fetchLiveFixtures] Error fetching fixtures", {
        error: error.message,
        stack: error.stack
      });
      return {
        fixtures: [],
        count: 0,
        success: false,
        error: error.message || "Unknown error occurred"
      };
    }
  }
});

const getFixtureStats = createTool({
  id: "get-fixture-stats",
  description: "Retrieves detailed statistics for a specific football match",
  inputSchema: z.object({
    fixtureId: z.number().describe("The ID of the football match")
  }),
  outputSchema: z.object({
    stats: z.array(z.any()),
    success: z.boolean(),
    error: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [getFixtureStats] Starting execution", {
      fixtureId: context.fixtureId
    });
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      logger?.error("\u274C [getFixtureStats] API_FOOTBALL_KEY not found");
      return {
        stats: [],
        success: false,
        error: "API_FOOTBALL_KEY not configured"
      };
    }
    try {
      const url = `https://v3.football.api-sports.io/fixtures/statistics?fixture=${context.fixtureId}`;
      logger?.info("\u{1F4E1} [getFixtureStats] Calling API-Football", { url });
      const response = await axios.get(url, {
        headers: { "x-apisports-key": apiKey },
        timeout: 15e3
      });
      if (response.status !== 200) {
        logger?.error("\u274C [getFixtureStats] API returned non-200 status", {
          status: response.status
        });
        return {
          stats: [],
          success: false,
          error: `API returned status ${response.status}`
        };
      }
      const stats = response.data.response || [];
      logger?.info("\u2705 [getFixtureStats] Successfully fetched stats", {
        statsCount: stats.length
      });
      return {
        stats,
        success: true
      };
    } catch (error) {
      logger?.error("\u274C [getFixtureStats] Error fetching stats", {
        error: error.message
      });
      return {
        stats: [],
        success: false,
        error: error.message || "Unknown error occurred"
      };
    }
  }
});

const calculatePressure = createTool({
  id: "calculate-pressure",
  description: "Calculates pressure metrics from match statistics (attacks, shots, corners)",
  inputSchema: z.object({
    stats: z.array(z.any()).describe("Match statistics from API-Football")
  }),
  outputSchema: z.object({
    pressHome: z.number(),
    pressAway: z.number(),
    pressTotal: z.number(),
    pressDiff: z.number(),
    attacksHome: z.number(),
    attacksAway: z.number(),
    shotsHome: z.number(),
    shotsAway: z.number(),
    cornersHome: z.number(),
    cornersAway: z.number(),
    success: z.boolean(),
    error: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [calculatePressure] Starting execution");
    try {
      if (!context.stats || context.stats.length < 2) {
        logger?.error("\u274C [calculatePressure] Insufficient stats data", {
          statsLength: context.stats?.length || 0
        });
        return {
          pressHome: 0,
          pressAway: 0,
          pressTotal: 0,
          pressDiff: 0,
          attacksHome: 0,
          attacksAway: 0,
          shotsHome: 0,
          shotsAway: 0,
          cornersHome: 0,
          cornersAway: 0,
          success: false,
          error: "Insufficient statistics data"
        };
      }
      const homeStats = context.stats[0];
      const awayStats = context.stats[1];
      const getStatValue = (team, key) => {
        const statistics = team.statistics || [];
        for (const item of statistics) {
          if (item.type?.toLowerCase() === key.toLowerCase()) {
            const val = item.value;
            if (val === null || val === void 0) return 0;
            if (typeof val === "number") return val;
            if (typeof val === "string") return parseInt(val, 10) || 0;
          }
        }
        return 0;
      };
      const attacksHome = getStatValue(homeStats, "Total attacks");
      const attacksAway = getStatValue(awayStats, "Total attacks");
      const shotsHome = getStatValue(homeStats, "Shots on Goal");
      const shotsAway = getStatValue(awayStats, "Shots on Goal");
      const cornersHome = getStatValue(homeStats, "Corner Kicks");
      const cornersAway = getStatValue(awayStats, "Corner Kicks");
      logger?.info("\u{1F4CA} [calculatePressure] Extracted stats", {
        attacksHome,
        attacksAway,
        shotsHome,
        shotsAway,
        cornersHome,
        cornersAway
      });
      const pressHome = attacksHome * 0.5 + shotsHome * 1.5 + cornersHome * 0.8;
      const pressAway = attacksAway * 0.5 + shotsAway * 1.5 + cornersAway * 0.8;
      const pressTotal = pressHome + pressAway;
      const pressDiff = Math.abs(pressHome - pressAway);
      logger?.info("\u2705 [calculatePressure] Calculated pressure metrics", {
        pressHome,
        pressAway,
        pressTotal,
        pressDiff
      });
      return {
        pressHome,
        pressAway,
        pressTotal,
        pressDiff,
        attacksHome,
        attacksAway,
        shotsHome,
        shotsAway,
        cornersHome,
        cornersAway,
        success: true
      };
    } catch (error) {
      logger?.error("\u274C [calculatePressure] Error calculating pressure", {
        error: error.message
      });
      return {
        pressHome: 0,
        pressAway: 0,
        pressTotal: 0,
        pressDiff: 0,
        attacksHome: 0,
        attacksAway: 0,
        shotsHome: 0,
        shotsAway: 0,
        cornersHome: 0,
        cornersAway: 0,
        success: false,
        error: error.message || "Unknown error occurred"
      };
    }
  }
});

const sendTelegramMessage = createTool({
  id: "send-telegram-message",
  description: "Sends a message via Telegram Bot API",
  inputSchema: z.object({
    message: z.string().describe("The message to send"),
    parseMode: z.enum(["HTML", "Markdown"]).optional().describe("Message formatting mode")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.number().optional(),
    error: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [sendTelegramMessage] Starting execution");
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      logger?.error("\u274C [sendTelegramMessage] Missing credentials", {
        hasToken: !!token,
        hasChatId: !!chatId
      });
      return {
        success: false,
        error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured"
      };
    }
    try {
      const bot = new TelegramBot(token);
      logger?.info("\u{1F4E4} [sendTelegramMessage] Sending message", {
        messageLength: context.message.length,
        parseMode: context.parseMode
      });
      const options = {};
      if (context.parseMode) {
        options.parse_mode = context.parseMode;
      }
      const result = await bot.sendMessage(chatId, context.message, options);
      logger?.info("\u2705 [sendTelegramMessage] Message sent successfully", {
        messageId: result.message_id
      });
      return {
        success: true,
        messageId: result.message_id
      };
    } catch (error) {
      logger?.error("\u274C [sendTelegramMessage] Error sending message", {
        error: error.message
      });
      return {
        success: false,
        error: error.message || "Unknown error occurred"
      };
    }
  }
});

const storeAlert = createTool({
  id: "store-alert",
  description: "Stores a football match alert prediction in the database",
  inputSchema: z.object({
    fixtureId: z.number().describe("The match fixture ID"),
    minute: z.number().describe("The minute when alert was triggered"),
    pressTotal: z.number().describe("Total pressure metric"),
    pressDiff: z.number().describe("Pressure difference between teams"),
    corners: z.number().describe("Total corners in the match"),
    shotsOnGoal: z.number().describe("Total shots on goal"),
    goalsAtAlert: z.number().describe("Total goals in match when alert was sent")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    alertId: z.number().optional(),
    error: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [storeAlert] Starting execution", {
      fixtureId: context.fixtureId,
      minute: context.minute
    });
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      logger?.error("\u274C [storeAlert] DATABASE_URL not found");
      return {
        success: false,
        error: "DATABASE_URL not configured"
      };
    }
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      const query = `
        INSERT INTO football_alerts 
        (fixture_id, minute, press_total, press_diff, corners, shots_on_goal, goals_at_alert)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      const values = [
        context.fixtureId,
        context.minute,
        context.pressTotal,
        context.pressDiff,
        context.corners,
        context.shotsOnGoal,
        context.goalsAtAlert
      ];
      logger?.info("\u{1F4BE} [storeAlert] Inserting alert into database", { values });
      const result = await client.query(query, values);
      const alertId = result.rows[0]?.id;
      logger?.info("\u2705 [storeAlert] Alert stored successfully", { alertId });
      return {
        success: true,
        alertId
      };
    } catch (error) {
      logger?.error("\u274C [storeAlert] Error storing alert", {
        error: error.message
      });
      return {
        success: false,
        error: error.message || "Unknown error occurred"
      };
    } finally {
      await client.end();
    }
  }
});

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

const performDailyAnalysis = createTool({
  id: "perform-daily-analysis",
  description: "Analyzes alert accuracy from the past 24 hours and calculates new threshold recommendations",
  inputSchema: z.object({}),
  outputSchema: z.object({
    matchesMonitored: z.number(),
    alertsSent: z.number(),
    goalsConfirmed: z.number(),
    accuracy: z.number(),
    currentThresholds: z.object({
      thresholdTotal: z.number(),
      thresholdDiff: z.number(),
      escanteios10min: z.number()
    }),
    recommendedThresholds: z.object({
      thresholdTotal: z.number(),
      thresholdDiff: z.number(),
      escanteios10min: z.number()
    }),
    success: z.boolean(),
    error: z.string().optional()
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [performDailyAnalysis] Starting daily analysis");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      logger?.error("\u274C [performDailyAnalysis] DATABASE_URL not found");
      return {
        matchesMonitored: 0,
        alertsSent: 0,
        goalsConfirmed: 0,
        accuracy: 0,
        currentThresholds: { thresholdTotal: 70, thresholdDiff: 15, escanteios10min: 3 },
        recommendedThresholds: { thresholdTotal: 70, thresholdDiff: 15, escanteios10min: 3 },
        success: false,
        error: "DATABASE_URL not configured"
      };
    }
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      const statsQuery = `
        SELECT 
          COUNT(*) as total_alerts,
          COUNT(CASE WHEN goal_happened = true THEN 1 END) as goals_confirmed,
          COUNT(DISTINCT fixture_id) as unique_matches
        FROM football_alerts
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND goal_happened IS NOT NULL
      `;
      logger?.info("\u{1F4CA} [performDailyAnalysis] Calculating statistics");
      const statsResult = await client.query(statsQuery);
      const stats = statsResult.rows[0];
      const alertsSent = parseInt(stats.total_alerts, 10) || 0;
      const goalsConfirmed = parseInt(stats.goals_confirmed, 10) || 0;
      const matchesMonitored = parseInt(stats.unique_matches, 10) || 0;
      const accuracy = alertsSent > 0 ? goalsConfirmed / alertsSent * 100 : 0;
      logger?.info("\u{1F4C8} [performDailyAnalysis] Statistics calculated", {
        matchesMonitored,
        alertsSent,
        goalsConfirmed,
        accuracy: accuracy.toFixed(2) + "%"
      });
      const thresholdsQuery = `
        SELECT threshold_total, threshold_diff, escanteios_10min
        FROM football_thresholds
        WHERE id = 1
      `;
      const thresholdsResult = await client.query(thresholdsQuery);
      const currentThresholds = thresholdsResult.rows[0];
      let thresholdTotal = parseFloat(currentThresholds.threshold_total);
      let thresholdDiff = parseFloat(currentThresholds.threshold_diff);
      let escanteios10min = parseInt(currentThresholds.escanteios_10min, 10);
      logger?.info("\u{1F3AF} [performDailyAnalysis] Current thresholds", {
        thresholdTotal,
        thresholdDiff,
        escanteios10min
      });
      let adjustmentFactor = 0;
      if (accuracy > 85) {
        adjustmentFactor = -0.05;
        logger?.info("\u{1F4C9} [performDailyAnalysis] High accuracy - decreasing thresholds");
      } else if (accuracy < 50 && alertsSent >= 3) {
        adjustmentFactor = 0.05;
        logger?.info("\u{1F4C8} [performDailyAnalysis] Low accuracy - increasing thresholds");
      } else {
        logger?.info("\u27A1\uFE0F [performDailyAnalysis] Accuracy within range - no adjustment");
      }
      let newThresholdTotal = thresholdTotal * (1 + adjustmentFactor);
      let newThresholdDiff = thresholdDiff * (1 + adjustmentFactor);
      let newEscanteios = escanteios10min;
      newThresholdTotal = Math.max(50, Math.min(120, newThresholdTotal));
      newThresholdDiff = Math.max(10, Math.min(30, newThresholdDiff));
      newEscanteios = Math.max(2, Math.min(6, newEscanteios));
      logger?.info("\u{1F3AF} [performDailyAnalysis] Recommended thresholds", {
        newThresholdTotal,
        newThresholdDiff,
        newEscanteios
      });
      if (adjustmentFactor !== 0) {
        const updateQuery = `
          UPDATE football_thresholds
          SET threshold_total = $1,
              threshold_diff = $2,
              escanteios_10min = $3,
              last_updated = NOW()
          WHERE id = 1
        `;
        await client.query(updateQuery, [
          newThresholdTotal,
          newThresholdDiff,
          newEscanteios
        ]);
        logger?.info("\u2705 [performDailyAnalysis] Thresholds updated in database");
      }
      return {
        matchesMonitored,
        alertsSent,
        goalsConfirmed,
        accuracy: Math.round(accuracy * 100) / 100,
        currentThresholds: {
          thresholdTotal,
          thresholdDiff,
          escanteios10min
        },
        recommendedThresholds: {
          thresholdTotal: Math.round(newThresholdTotal * 100) / 100,
          thresholdDiff: Math.round(newThresholdDiff * 100) / 100,
          escanteios10min: newEscanteios
        },
        success: true
      };
    } catch (error) {
      logger?.error("\u274C [performDailyAnalysis] Error performing analysis", {
        error: error.message
      });
      return {
        matchesMonitored: 0,
        alertsSent: 0,
        goalsConfirmed: 0,
        accuracy: 0,
        currentThresholds: { thresholdTotal: 70, thresholdDiff: 15, escanteios10min: 3 },
        recommendedThresholds: { thresholdTotal: 70, thresholdDiff: 15, escanteios10min: 3 },
        success: false,
        error: error.message || "Unknown error occurred"
      };
    } finally {
      await client.end();
    }
  }
});

const getCurrentThresholds = createTool({
  id: "get-current-thresholds",
  description: "Retrieves the current adaptive thresholds from the database for alert evaluation",
  inputSchema: z.object({}),
  outputSchema: z.object({
    thresholdTotal: z.number(),
    thresholdDiff: z.number(),
    escanteios10min: z.number(),
    lastUpdated: z.string(),
    success: z.boolean(),
    error: z.string().optional()
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [getCurrentThresholds] Starting execution");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      logger?.error("\u274C [getCurrentThresholds] DATABASE_URL not found");
      return {
        thresholdTotal: 70,
        thresholdDiff: 15,
        escanteios10min: 3,
        lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
        success: false,
        error: "DATABASE_URL not configured"
      };
    }
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      const query = `
        SELECT threshold_total, threshold_diff, escanteios_10min, last_updated
        FROM football_thresholds
        WHERE id = 1
      `;
      logger?.info("\u{1F4CA} [getCurrentThresholds] Querying thresholds");
      const result = await client.query(query);
      if (result.rows.length === 0) {
        logger?.warn("\u26A0\uFE0F [getCurrentThresholds] No thresholds found, using defaults");
        return {
          thresholdTotal: 70,
          thresholdDiff: 15,
          escanteios10min: 3,
          lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
          success: true
        };
      }
      const row = result.rows[0];
      const thresholds = {
        thresholdTotal: parseFloat(row.threshold_total),
        thresholdDiff: parseFloat(row.threshold_diff),
        escanteios10min: parseInt(row.escanteios_10min, 10),
        lastUpdated: row.last_updated?.toISOString() || (/* @__PURE__ */ new Date()).toISOString(),
        success: true
      };
      logger?.info("\u2705 [getCurrentThresholds] Retrieved thresholds", thresholds);
      return thresholds;
    } catch (error) {
      logger?.error("\u274C [getCurrentThresholds] Error retrieving thresholds", {
        error: error.message
      });
      return {
        thresholdTotal: 70,
        thresholdDiff: 15,
        escanteios10min: 3,
        lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
        success: false,
        error: error.message || "Unknown error occurred"
      };
    } finally {
      await client.end();
    }
  }
});

const footballMonitorAgent = new Agent({
  name: "Football Monitor Agent",
  instructions: `
You are an adaptive learning football match monitoring agent. Your role is to:

1. **Analyze Match Pressure**: Evaluate live football matches using pressure metrics (attacks, shots on goal, corners) to identify high-probability goal situations.

2. **Decision Making**: Determine when to send alerts based on:
   - Total pressure (press_total)
   - Pressure difference between teams (press_diff)
   - Shots on goal and corners
   - Current adaptive thresholds from the database

3. **Alert Criteria**: Send an alert when:
   - Total pressure >= current threshold_total OR
   - Pressure difference >= current threshold_diff AND shots on goal >= 2 OR
   - Corners in last period >= escanteios_10min threshold

4. **Daily Analysis**: Evaluate your own performance by:
   - Calculating accuracy rate (goals confirmed / alerts sent)
   - Recommending threshold adjustments:
     * If accuracy > 85%: Decrease thresholds by 5% (be more aggressive)
     * If accuracy < 50% and alerts >= 3: Increase thresholds by 5% (be more conservative)
     * If accuracy 50-85%: Keep thresholds unchanged

5. **Communication**: Format Telegram messages clearly with:
   - Match info (teams, score, minute)
   - Pressure metrics
   - Probability assessment
   - Actionable recommendations
   - Daily reports with performance stats

Always be data-driven and transparent about your reasoning. Your goal is to continuously improve prediction accuracy through adaptive learning.
`,
  model: openai("gpt-4o"),
  tools: {
    fetchLiveFixtures,
    getFixtureStats,
    calculatePressure,
    sendTelegramMessage,
    storeAlert,
    verifyGoalOutcomes,
    performDailyAnalysis,
    getCurrentThresholds
  },
  memory: new Memory({
    storage: new LibSQLStore({
      url: ":memory:"
    })
  })
});

const checkMidnightAndRunAnalysis = createStep({
  id: "check-midnight-and-run-analysis",
  description: "Checks if it's midnight UTC and runs daily analysis if needed",
  inputSchema: z.object({}),
  outputSchema: z.object({
    isMidnight: z.boolean(),
    analysisRun: z.boolean(),
    analysisReport: z.string().optional()
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [checkMidnightAndRunAnalysis] Starting execution");
    const now = /* @__PURE__ */ new Date();
    const hours = now.getUTCHours();
    const minutes = now.getUTCMinutes();
    const isMidnight = hours === 0 && minutes === 0;
    logger?.info("\u23F0 [checkMidnightAndRunAnalysis] Time check", {
      hours,
      minutes,
      isMidnight
    });
    if (!isMidnight) {
      logger?.info("\u23ED\uFE0F [checkMidnightAndRunAnalysis] Not midnight, skipping analysis");
      return {
        isMidnight: false,
        analysisRun: false
      };
    }
    logger?.info("\u{1F319} [checkMidnightAndRunAnalysis] Midnight detected, running daily analysis");
    const agentResponse = await footballMonitorAgent.generateLegacy([
      {
        role: "user",
        content: `It's midnight UTC. Please perform the daily analysis:
        
1. Use the performDailyAnalysis tool to analyze yesterday's performance
2. Generate a comprehensive daily report
3. Send the report via Telegram using sendTelegramMessage tool

The report should include:
- Matches monitored in last 24 hours
- Total alerts sent
- Goals confirmed after alerts
- Accuracy percentage
- Current vs recommended thresholds
- Performance assessment

Format the message beautifully for Telegram with emojis and clear sections.`
      }
    ]);
    logger?.info("\u2705 [checkMidnightAndRunAnalysis] Daily analysis completed", {
      responseLength: agentResponse.text.length
    });
    return {
      isMidnight: true,
      analysisRun: true,
      analysisReport: agentResponse.text
    };
  }
});
const monitorLiveMatches = createStep({
  id: "monitor-live-matches",
  description: "Monitors live football matches and sends alerts for high-pressure situations",
  inputSchema: z.object({
    isMidnight: z.boolean(),
    analysisRun: z.boolean(),
    analysisReport: z.string().optional()
  }),
  outputSchema: z.object({
    fixturesChecked: z.number(),
    alertsSent: z.number(),
    success: z.boolean(),
    summary: z.string()
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("\u{1F527} [monitorLiveMatches] Starting execution");
    try {
      const agentResponse = await footballMonitorAgent.generateLegacy([
        {
          role: "user",
          content: `Monitor live football matches and send alerts for high-probability goal situations:

1. Use getCurrentThresholds tool to get the current adaptive thresholds
2. Use fetchLiveFixtures tool to get all live matches
3. For each live match:
   a. Use getFixtureStats tool to get detailed statistics
   b. Use calculatePressure tool to compute pressure metrics
   c. Get the current goal count from the fixture (homeGoals + awayGoals)
   d. Evaluate if alert should be sent based on current thresholds:
      - Total pressure >= threshold_total
      - Pressure difference >= threshold_diff AND shots on goal >= 2
      - Corners >= escanteios_10min threshold
   e. If alert criteria met:
      - Format a beautiful Telegram message with match details, pressure metrics, and recommendation
      - Use sendTelegramMessage tool to send alert
      - Use storeAlert tool to save the prediction to database (IMPORTANT: include goalsAtAlert parameter with current goal count)
4. Use verifyGoalOutcomes tool to check alerts older than 10 minutes and update their goal_happened status

Provide a brief summary of monitoring results.`
        }
      ]);
      logger?.info("\u2705 [monitorLiveMatches] Monitoring completed", {
        responseLength: agentResponse.text.length
      });
      return {
        fixturesChecked: 0,
        alertsSent: 0,
        success: true,
        summary: agentResponse.text
      };
    } catch (error) {
      logger?.error("\u274C [monitorLiveMatches] Error monitoring matches", {
        error: error.message
      });
      return {
        fixturesChecked: 0,
        alertsSent: 0,
        success: false,
        summary: `Error: ${error.message}`
      };
    }
  }
});
const footballMonitorWorkflow = createWorkflow({
  id: "football-monitor-workflow",
  inputSchema: z.object({}),
  outputSchema: z.object({
    fixturesChecked: z.number(),
    alertsSent: z.number(),
    success: z.boolean(),
    summary: z.string()
  })
}).then(checkMidnightAndRunAnalysis).then(monitorLiveMatches).commit();

class ProductionPinoLogger extends MastraLogger {
  logger;
  constructor(options = {}) {
    super(options);
    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label, _number) => ({
          level: label
        })
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`
    });
  }
  debug(message, args = {}) {
    this.logger.debug(args, message);
  }
  info(message, args = {}) {
    this.logger.info(args, message);
  }
  warn(message, args = {}) {
    this.logger.warn(args, message);
  }
  error(message, args = {}) {
    this.logger.error(args, message);
  }
}
const mastra = new Mastra({
  storage: sharedPostgresStorage,
  // Register your workflows here
  workflows: {
    footballMonitorWorkflow
  },
  // Register your agents here
  agents: {
    footballMonitorAgent
  },
  mcpServers: {
    allTools: new MCPServer({
      name: "allTools",
      version: "1.0.0",
      tools: {}
    })
  },
  bundler: {
    // A few dependencies are not properly picked up by
    // the bundler if they are not added directly to the
    // entrypoint.
    externals: ["@slack/web-api", "inngest", "inngest/hono", "hono", "hono/streaming"],
    // sourcemaps are good for debugging.
    sourcemap: true
  },
  server: {
    host: "0.0.0.0",
    port: 5e3,
    middleware: [async (c, next) => {
      const mastra2 = c.get("mastra");
      const logger = mastra2?.getLogger();
      logger?.debug("[Request]", {
        method: c.req.method,
        url: c.req.url
      });
      try {
        await next();
      } catch (error) {
        logger?.error("[Response]", {
          method: c.req.method,
          url: c.req.url,
          error
        });
        if (error instanceof MastraError) {
          if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
            throw new NonRetriableError(error.message, {
              cause: error
            });
          }
        } else if (error instanceof z.ZodError) {
          throw new NonRetriableError(error.message, {
            cause: error
          });
        }
        throw error;
      }
    }],
    apiRoutes: [
      // This API route is used to register the Mastra workflow (inngest function) on the inngest server
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({
          mastra: mastra2
        }) => inngestServe({
          mastra: mastra2,
          inngest
        })
        // The inngestServe function integrates Mastra workflows with Inngest by:
        // 1. Creating Inngest functions for each workflow with unique IDs (workflow.${workflowId})
        // 2. Setting up event handlers that:
        //    - Generate unique run IDs for each workflow execution
        //    - Create an InngestExecutionEngine to manage step execution
        //    - Handle workflow state persistence and real-time updates
        // 3. Establishing a publish-subscribe system for real-time monitoring
        //    through the workflow:${workflowId}:${runId} channel
      }
    ]
  },
  logger: process.env.NODE_ENV === "production" ? new ProductionPinoLogger({
    name: "Mastra",
    level: "info"
  }) : new PinoLogger({
    name: "Mastra",
    level: "info"
  })
});
if (Object.keys(mastra.getWorkflows()).length > 1) {
  throw new Error("More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.");
}
if (Object.keys(mastra.getAgents()).length > 1) {
  throw new Error("More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.");
}
registerCronWorkflow("* * * * *", footballMonitorWorkflow);

export { mastra };
