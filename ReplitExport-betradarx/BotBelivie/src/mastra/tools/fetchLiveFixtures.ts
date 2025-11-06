import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import axios from "axios";

export const fetchLiveFixtures = createTool({
  id: "fetch-live-fixtures",
  description: "Fetches all currently live football matches from API-Football",
  
  inputSchema: z.object({}),
  
  outputSchema: z.object({
    fixtures: z.array(z.any()),
    count: z.number(),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [fetchLiveFixtures] Starting execution");
    
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      logger?.error("❌ [fetchLiveFixtures] API_FOOTBALL_KEY not found in environment");
      return {
        fixtures: [],
        count: 0,
        success: false,
        error: "API_FOOTBALL_KEY not configured",
      };
    }
    
    try {
      const url = "https://v3.football.api-sports.io/fixtures?live=all";
      logger?.info("📡 [fetchLiveFixtures] Calling API-Football", { url });
      
      const response = await axios.get(url, {
        headers: { "x-apisports-key": apiKey },
        timeout: 15000,
      });
      
      if (response.status !== 200) {
        logger?.error("❌ [fetchLiveFixtures] API returned non-200 status", {
          status: response.status,
          data: response.data,
        });
        return {
          fixtures: [],
          count: 0,
          success: false,
          error: `API returned status ${response.status}`,
        };
      }
      
      const fixtures = response.data.response || [];
      logger?.info("✅ [fetchLiveFixtures] Successfully fetched fixtures", {
        count: fixtures.length,
      });
      
      return {
        fixtures,
        count: fixtures.length,
        success: true,
      };
    } catch (error: any) {
      logger?.error("❌ [fetchLiveFixtures] Error fetching fixtures", {
        error: error.message,
        stack: error.stack,
      });
      
      return {
        fixtures: [],
        count: 0,
        success: false,
        error: error.message || "Unknown error occurred",
      };
    }
  },
});
