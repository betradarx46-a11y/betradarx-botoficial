import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { footballMonitorAgent } from "../agents/footballMonitorAgent";
import pg from "pg";

const checkMidnightAndRunAnalysis = createStep({
  id: "check-midnight-and-run-analysis",
  description: "Checks if it's midnight UTC and runs daily analysis if needed",

  inputSchema: z.object({}),

  outputSchema: z.object({
    isMidnight: z.boolean(),
    analysisRun: z.boolean(),
    analysisReport: z.string().optional(),
  }),

  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [checkMidnightAndRunAnalysis] Starting execution");

    const now = new Date();
    const hours = now.getUTCHours();
    const minutes = now.getUTCMinutes();

    const isMidnight = hours === 0 && minutes === 0;

    logger?.info("⏰ [checkMidnightAndRunAnalysis] Time check", {
      hours,
      minutes,
      isMidnight,
    });

    if (!isMidnight) {
      logger?.info("⏭️ [checkMidnightAndRunAnalysis] Not midnight, skipping analysis");
      return {
        isMidnight: false,
        analysisRun: false,
      };
    }

    logger?.info("🌙 [checkMidnightAndRunAnalysis] Midnight detected, running daily analysis");

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

Format the message beautifully for Telegram with emojis and clear sections.`,
      },
    ]);

    logger?.info("✅ [checkMidnightAndRunAnalysis] Daily analysis completed", {
      responseLength: agentResponse.text.length,
    });

    return {
      isMidnight: true,
      analysisRun: true,
      analysisReport: agentResponse.text,
    };
  },
});

const monitorLiveMatches = createStep({
  id: "monitor-live-matches",
  description: "Monitors live football matches and sends alerts for high-pressure situations",

  inputSchema: z.object({
    isMidnight: z.boolean(),
    analysisRun: z.boolean(),
    analysisReport: z.string().optional(),
  }),

  outputSchema: z.object({
    fixturesChecked: z.number(),
    alertsSent: z.number(),
    success: z.boolean(),
    summary: z.string(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [monitorLiveMatches] Starting execution");

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

Provide a brief summary of monitoring results.`,
        },
      ]);

      logger?.info("✅ [monitorLiveMatches] Monitoring completed", {
        responseLength: agentResponse.text.length,
      });

      return {
        fixturesChecked: 0,
        alertsSent: 0,
        success: true,
        summary: agentResponse.text,
      };
    } catch (error: any) {
      logger?.error("❌ [monitorLiveMatches] Error monitoring matches", {
        error: error.message,
      });

      return {
        fixturesChecked: 0,
        alertsSent: 0,
        success: false,
        summary: `Error: ${error.message}`,
      };
    }
  },
});

export const footballMonitorWorkflow = createWorkflow({
  id: "football-monitor-workflow",
  inputSchema: z.object({}),
  outputSchema: z.object({
    fixturesChecked: z.number(),
    alertsSent: z.number(),
    success: z.boolean(),
    summary: z.string(),
  }),
})
  .then(checkMidnightAndRunAnalysis)
  .then(monitorLiveMatches)
  .commit();
