import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import pg from "pg";

export const performDailyAnalysis = createTool({
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
      escanteios10min: z.number(),
    }),
    recommendedThresholds: z.object({
      thresholdTotal: z.number(),
      thresholdDiff: z.number(),
      escanteios10min: z.number(),
    }),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [performDailyAnalysis] Starting daily analysis");
    
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      logger?.error("❌ [performDailyAnalysis] DATABASE_URL not found");
      return {
        matchesMonitored: 0,
        alertsSent: 0,
        goalsConfirmed: 0,
        accuracy: 0,
        currentThresholds: { thresholdTotal: 70, thresholdDiff: 15, escanteios10min: 3 },
        recommendedThresholds: { thresholdTotal: 70, thresholdDiff: 15, escanteios10min: 3 },
        success: false,
        error: "DATABASE_URL not configured",
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
      
      logger?.info("📊 [performDailyAnalysis] Calculating statistics");
      const statsResult = await client.query(statsQuery);
      const stats = statsResult.rows[0];
      
      const alertsSent = parseInt(stats.total_alerts, 10) || 0;
      const goalsConfirmed = parseInt(stats.goals_confirmed, 10) || 0;
      const matchesMonitored = parseInt(stats.unique_matches, 10) || 0;
      const accuracy = alertsSent > 0 ? (goalsConfirmed / alertsSent) * 100 : 0;
      
      logger?.info("📈 [performDailyAnalysis] Statistics calculated", {
        matchesMonitored,
        alertsSent,
        goalsConfirmed,
        accuracy: accuracy.toFixed(2) + "%",
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
      
      logger?.info("🎯 [performDailyAnalysis] Current thresholds", {
        thresholdTotal,
        thresholdDiff,
        escanteios10min,
      });
      
      let adjustmentFactor = 0;
      if (accuracy > 85) {
        adjustmentFactor = -0.05;
        logger?.info("📉 [performDailyAnalysis] High accuracy - decreasing thresholds");
      } else if (accuracy < 50 && alertsSent >= 3) {
        adjustmentFactor = 0.05;
        logger?.info("📈 [performDailyAnalysis] Low accuracy - increasing thresholds");
      } else {
        logger?.info("➡️ [performDailyAnalysis] Accuracy within range - no adjustment");
      }
      
      let newThresholdTotal = thresholdTotal * (1 + adjustmentFactor);
      let newThresholdDiff = thresholdDiff * (1 + adjustmentFactor);
      let newEscanteios = escanteios10min;
      
      newThresholdTotal = Math.max(50, Math.min(120, newThresholdTotal));
      newThresholdDiff = Math.max(10, Math.min(30, newThresholdDiff));
      newEscanteios = Math.max(2, Math.min(6, newEscanteios));
      
      logger?.info("🎯 [performDailyAnalysis] Recommended thresholds", {
        newThresholdTotal,
        newThresholdDiff,
        newEscanteios,
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
          newEscanteios,
        ]);
        
        logger?.info("✅ [performDailyAnalysis] Thresholds updated in database");
      }
      
      return {
        matchesMonitored,
        alertsSent,
        goalsConfirmed,
        accuracy: Math.round(accuracy * 100) / 100,
        currentThresholds: {
          thresholdTotal,
          thresholdDiff,
          escanteios10min,
        },
        recommendedThresholds: {
          thresholdTotal: Math.round(newThresholdTotal * 100) / 100,
          thresholdDiff: Math.round(newThresholdDiff * 100) / 100,
          escanteios10min: newEscanteios,
        },
        success: true,
      };
    } catch (error: any) {
      logger?.error("❌ [performDailyAnalysis] Error performing analysis", {
        error: error.message,
      });
      
      return {
        matchesMonitored: 0,
        alertsSent: 0,
        goalsConfirmed: 0,
        accuracy: 0,
        currentThresholds: { thresholdTotal: 70, thresholdDiff: 15, escanteios10min: 3 },
        recommendedThresholds: { thresholdTotal: 70, thresholdDiff: 15, escanteios10min: 3 },
        success: false,
        error: error.message || "Unknown error occurred",
      };
    } finally {
      await client.end();
    }
  },
});
