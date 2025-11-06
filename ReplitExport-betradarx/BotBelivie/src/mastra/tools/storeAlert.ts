import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import pg from "pg";

export const storeAlert = createTool({
  id: "store-alert",
  description: "Stores a football match alert prediction in the database",
  
  inputSchema: z.object({
    fixtureId: z.number().describe("The match fixture ID"),
    minute: z.number().describe("The minute when alert was triggered"),
    pressTotal: z.number().describe("Total pressure metric"),
    pressDiff: z.number().describe("Pressure difference between teams"),
    corners: z.number().describe("Total corners in the match"),
    shotsOnGoal: z.number().describe("Total shots on goal"),
    goalsAtAlert: z.number().describe("Total goals in match when alert was sent"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    alertId: z.number().optional(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [storeAlert] Starting execution", {
      fixtureId: context.fixtureId,
      minute: context.minute,
    });
    
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      logger?.error("❌ [storeAlert] DATABASE_URL not found");
      return {
        success: false,
        error: "DATABASE_URL not configured",
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
        context.goalsAtAlert,
      ];
      
      logger?.info("💾 [storeAlert] Inserting alert into database", { values });
      
      const result = await client.query(query, values);
      const alertId = result.rows[0]?.id;
      
      logger?.info("✅ [storeAlert] Alert stored successfully", { alertId });
      
      return {
        success: true,
        alertId,
      };
    } catch (error: any) {
      logger?.error("❌ [storeAlert] Error storing alert", {
        error: error.message,
      });
      
      return {
        success: false,
        error: error.message || "Unknown error occurred",
      };
    } finally {
      await client.end();
    }
  },
});
