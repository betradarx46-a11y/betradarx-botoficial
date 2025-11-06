import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { fetchLiveFixtures } from "../tools/fetchLiveFixtures";
import { getFixtureStats } from "../tools/getFixtureStats";
import { calculatePressure } from "../tools/calculatePressure";
import { sendTelegramMessage } from "../tools/sendTelegramMessage";
import { storeAlert } from "../tools/storeAlert";
import { verifyGoalOutcomes } from "../tools/verifyGoalOutcomes";
import { performDailyAnalysis } from "../tools/performDailyAnalysis";
import { getCurrentThresholds } from "../tools/getCurrentThresholds";

export const footballMonitorAgent = new Agent({
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
    getCurrentThresholds,
  },

  memory: new Memory({
    storage: new LibSQLStore({
      url: ":memory:",
    }),
  }),
});
