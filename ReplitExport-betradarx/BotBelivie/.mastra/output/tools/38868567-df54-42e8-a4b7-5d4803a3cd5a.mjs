import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';

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

export { getFixtureStats };
//# sourceMappingURL=38868567-df54-42e8-a4b7-5d4803a3cd5a.mjs.map
