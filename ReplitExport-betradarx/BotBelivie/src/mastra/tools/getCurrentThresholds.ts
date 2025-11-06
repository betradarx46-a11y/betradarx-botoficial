import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import pg from "pg";

export const getCurrentThresholds = createTool({
  id: "get-current-thresholds",
  description: "Retrieves the current adaptive thresholds from the database for alert evaluation",
  
  inputSchema: z.object({}),
  
  outputSchema: z.object({
    thresholdTotal: z.number(),
    thresholdDiff: z.number(),
    escanteios10min: z.number(),
    lastUpdated: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getCurrentThresholds] Starting execution");
    
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      logger?.error("❌ [getCurrentThresholds] DATABASE_URL not found");
      return {
        thresholdTotal: 70,
        thresholdDiff: 15,
        escanteios10min: 3,
        lastUpdated: new Date().toISOString(),
        success: false,
        error: "DATABASE_URL not configured",
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
      
      logger?.info("📊 [getCurrentThresholds] Querying thresholds");
      const result = await client.query(query);
      
      if (result.rows.length === 0) {
        logger?.warn("⚠️ [getCurrentThresholds] No thresholds found, using defaults");
        return {
          thresholdTotal: 70,
          thresholdDiff: 15,
          escanteios10min: 3,
          lastUpdated: new Date().toISOString(),
          success: true,
        };
      }
      
      const row = result.rows[0];
      const thresholds = {
        thresholdTotal: parseFloat(row.threshold_total),
        thresholdDiff: parseFloat(row.threshold_diff),
        escanteios10min: parseInt(row.escanteios_10min, 10),
        lastUpdated: row.last_updated?.toISOString() || new Date().toISOString(),
        success: true,
      };
      
      logger?.info("✅ [getCurrentThresholds] Retrieved thresholds", thresholds);
      
      return thresholds;
    } catch (error: any) {
      logger?.error("❌ [getCurrentThresholds] Error retrieving thresholds", {
        error: error.message,
      });
      
      return {
        thresholdTotal: 70,
        thresholdDiff: 15,
        escanteios10min: 3,
        lastUpdated: new Date().toISOString(),
        success: false,
        error: error.message || "Unknown error occurred",
      };
    } finally {
      await client.end();
    }
  },
});
