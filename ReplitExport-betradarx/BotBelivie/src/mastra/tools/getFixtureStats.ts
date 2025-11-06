import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import axios from "axios";

export const getFixtureStats = createTool({
  id: "get-fixture-stats",
  description: "Retrieves detailed statistics for a specific football match",
  
  inputSchema: z.object({
    fixtureId: z.number().describe("The ID of the football match"),
  }),
  
  outputSchema: z.object({
    stats: z.array(z.any()),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [getFixtureStats] Starting execution", {
      fixtureId: context.fixtureId,
    });
    
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      logger?.error("❌ [getFixtureStats] API_FOOTBALL_KEY not found");
      return {
        stats: [],
        success: false,
        error: "API_FOOTBALL_KEY not configured",
      };
    }
    
    try {
      const url = `https://v3.football.api-sports.io/fixtures/statistics?fixture=${context.fixtureId}`;
      logger?.info("📡 [getFixtureStats] Calling API-Football", { url });
      
      const response = await axios.get(url, {
        headers: { "x-apisports-key": apiKey },
        timeout: 15000,
      });
      
      if (response.status !== 200) {
        logger?.error("❌ [getFixtureStats] API returned non-200 status", {
          status: response.status,
        });
        return {
          stats: [],
          success: false,
          error: `API returned status ${response.status}`,
        };
      }
      
      const stats = response.data.response || [];
      logger?.info("✅ [getFixtureStats] Successfully fetched stats", {
        statsCount: stats.length,
      });
      
      return {
        stats,
        success: true,
      };
    } catch (error: any) {
      logger?.error("❌ [getFixtureStats] Error fetching stats", {
        error: error.message,
      });
      
      return {
        stats: [],
        success: false,
        error: error.message || "Unknown error occurred",
      };
    }
  },
});
