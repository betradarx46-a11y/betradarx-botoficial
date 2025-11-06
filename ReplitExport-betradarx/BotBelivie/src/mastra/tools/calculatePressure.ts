import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const calculatePressure = createTool({
  id: "calculate-pressure",
  description: "Calculates pressure metrics from match statistics (attacks, shots, corners)",
  
  inputSchema: z.object({
    stats: z.array(z.any()).describe("Match statistics from API-Football"),
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
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [calculatePressure] Starting execution");
    
    try {
      if (!context.stats || context.stats.length < 2) {
        logger?.error("❌ [calculatePressure] Insufficient stats data", {
          statsLength: context.stats?.length || 0,
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
          error: "Insufficient statistics data",
        };
      }
      
      const homeStats = context.stats[0];
      const awayStats = context.stats[1];
      
      const getStatValue = (team: any, key: string): number => {
        const statistics = team.statistics || [];
        for (const item of statistics) {
          if (item.type?.toLowerCase() === key.toLowerCase()) {
            const val = item.value;
            if (val === null || val === undefined) return 0;
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
      
      logger?.info("📊 [calculatePressure] Extracted stats", {
        attacksHome,
        attacksAway,
        shotsHome,
        shotsAway,
        cornersHome,
        cornersAway,
      });
      
      const pressHome = attacksHome * 0.5 + shotsHome * 1.5 + cornersHome * 0.8;
      const pressAway = attacksAway * 0.5 + shotsAway * 1.5 + cornersAway * 0.8;
      const pressTotal = pressHome + pressAway;
      const pressDiff = Math.abs(pressHome - pressAway);
      
      logger?.info("✅ [calculatePressure] Calculated pressure metrics", {
        pressHome,
        pressAway,
        pressTotal,
        pressDiff,
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
        success: true,
      };
    } catch (error: any) {
      logger?.error("❌ [calculatePressure] Error calculating pressure", {
        error: error.message,
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
        error: error.message || "Unknown error occurred",
      };
    }
  },
});
