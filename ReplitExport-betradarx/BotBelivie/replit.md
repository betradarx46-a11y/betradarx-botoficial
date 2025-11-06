# Football Match Monitoring Agent

## Overview

This is a TypeScript-based AI agent system built with the Mastra framework that monitors live football matches and predicts goal-scoring opportunities using pressure metrics. The system uses adaptive machine learning to continuously improve its prediction accuracy by analyzing historical alert performance and automatically adjusting detection thresholds.

The agent monitors live matches through the API-Football service, calculates pressure indicators from match statistics (attacks, shots, corners), sends real-time alerts via Telegram when high-probability goal situations are detected, and performs daily self-analysis to optimize prediction accuracy.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Framework: Mastra Agent System

The application is built on the Mastra framework, a TypeScript agent framework that provides primitives for AI agents, workflows, tools, and memory management. The architecture follows a modular design where agents coordinate multiple specialized tools to accomplish complex tasks.

**Key architectural decisions:**
- **Agent-based orchestration**: The `footballMonitorAgent` acts as the central intelligence, coordinating tool execution and decision-making
- **Tool-based modularity**: Each capability (API calls, calculations, database operations, messaging) is encapsulated as a discrete, reusable tool
- **Workflow automation**: Inngest provides scheduled workflows for periodic monitoring and daily analysis
- **Type safety**: Zod schemas enforce runtime validation across all tool inputs/outputs and workflow steps

### AI Model Integration

**Model Provider**: OpenAI GPT-4o
- Used for natural language understanding and decision-making within the agent
- The agent interprets match statistics and determines when to send alerts
- Handles daily performance analysis and threshold recommendations

**Rationale**: GPT-4o provides the reasoning capabilities needed to evaluate complex match scenarios and make nuanced decisions about alert thresholds based on historical performance data.

### External API Integration

**API-Football (v3.football.api-sports.io)**
- Purpose: Real-time football match data and statistics
- Endpoints used:
  - `/fixtures?live=all` - Fetches all currently live matches
  - `/fixtures/statistics?fixture={id}` - Retrieves detailed match statistics
- Authentication: API key via `x-apisports-key` header
- Rate limiting consideration: 15-second timeout configured

**Design decision**: The system uses API-Football as the single source of truth for match data rather than maintaining its own match database, simplifying architecture and ensuring data freshness.

### Messaging System

**Telegram Bot API**
- Purpose: Real-time alert delivery to end users
- Configuration: Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
- Message formatting: Supports HTML/Markdown for rich formatting
- Implementation: Uses `node-telegram-bot-api` library

**Rationale**: Telegram provides reliable, instant message delivery with rich formatting options. The bot architecture allows for easy expansion to multiple users or channels.

### Data Persistence Layer

**PostgreSQL Database**
- Primary storage for application state and learning data
- Schema design:
  - `football_alerts`: Stores historical alert predictions with outcome tracking
  - `football_thresholds`: Maintains adaptive threshold parameters
  
**Key tables:**
```sql
football_alerts (
  id, fixture_id, minute, press_total, press_diff, 
  corners, shots_on_goal, goals_at_alert, goal_happened, created_at
)

football_thresholds (
  id, threshold_total, threshold_diff, escanteios_10min, last_updated
)
```

**Design decision**: PostgreSQL chosen over NoSQL solutions because:
- Structured data with clear relationships
- ACID compliance critical for accurate learning metrics
- SQL queries simplify historical analysis calculations
- Mastra provides native PostgreSQL integration via `@mastra/pg`

### Adaptive Learning System

**Self-improvement mechanism:**
1. **Data collection**: Every alert stores prediction context and baseline goal count
2. **Outcome verification**: `verifyGoalOutcomes` tool checks if goals occurred after alerts (10-minute window)
3. **Daily analysis**: Calculates accuracy rate = (confirmed goals / total alerts)
4. **Threshold adjustment logic**:
   - Accuracy > 85%: Decrease thresholds by 5% (increase sensitivity)
   - Accuracy < 50% with ≥3 alerts: Increase thresholds by 5% (reduce false positives)
   - Accuracy 50-85%: Maintain current thresholds

**Rationale**: This creates a feedback loop where the system becomes more accurate over time without manual tuning. The conservative adjustment rate (5%) prevents overcorrection from small sample sizes.

### Workflow Orchestration

**Inngest Integration**
- Purpose: Scheduled background jobs and event-driven workflows
- Configuration: Development mode with realtime middleware for local testing
- Workflows:
  - `footballMonitorWorkflow`: Periodic live match monitoring (configured interval)
  - Daily analysis workflow: Performance evaluation and threshold updates

**Development vs Production**:
- Development: `isDev: true`, local server at `localhost:3000`, zero retries
- Production: Named instance with 3 retry attempts for resilience

**Rationale**: Inngest provides durable execution with built-in retry logic and step memoization, ensuring workflows complete even if individual steps fail temporarily.

### Pressure Calculation Algorithm

**Metrics computed:**
- `press_home` / `press_away`: Per-team pressure (attacks × 0.4 + shots × 0.6)
- `press_total`: Combined pressure of both teams
- `press_diff`: Absolute difference in team pressures
- Additional tracking: corners, shots on goal

**Alert triggers:**
- Total pressure ≥ threshold_total (default: 70)
- Pressure difference ≥ threshold_diff (default: 15) AND shots ≥ 2
- Recent corners ≥ escanteios_10min (default: 3)

**Rationale**: The weighted formula prioritizes shots (60%) over general attacks (40%) because shots are stronger goal indicators. Multiple trigger conditions prevent over-reliance on any single metric.

### Environment Configuration

**Required environment variables:**
```
API_FOOTBALL_KEY - API-Football service authentication
TELEGRAM_BOT_TOKEN - Telegram bot authentication
TELEGRAM_CHAT_ID - Target chat for alerts
DATABASE_URL - PostgreSQL connection string
OPENAI_API_KEY - OpenAI API authentication
NODE_ENV - Environment indicator (production/development)
```

**Fallback strategy**: Tools gracefully degrade when credentials are missing, returning error states rather than crashing, enabling partial system operation during configuration issues.

### Logging and Observability

**Pino logger integration:**
- Structured JSON logging
- Different log levels (debug, info, warn, error)
- ISO timestamp formatting
- Integration with Mastra's logger interface

**Production logger customization**: Custom `ProductionPinoLogger` class extends `MastraLogger` to provide consistent formatting and timestamp standards across all components.

### Module System

**TypeScript configuration:**
- ES2022 module system with bundler resolution
- Strict mode enabled for type safety
- ESM imports throughout (`.mjs` output)

**Design decision**: ES modules chosen for modern JavaScript compatibility and better tree-shaking. The bundler module resolution provides flexibility for both development and production builds.

## External Dependencies

### Third-party APIs
- **API-Football**: Live match data and statistics (requires API key)

### LLM Services
- **OpenAI GPT-4o**: Agent reasoning and decision-making (requires API key)
- **AI SDK**: Vercel AI SDK for model routing and provider abstraction

### Communication Services
- **Telegram Bot API**: Alert delivery system (requires bot token and chat ID)

### Database
- **PostgreSQL**: Primary data store for alerts and adaptive thresholds

### Framework and Libraries
- **Mastra Core** (`@mastra/core`): Agent and workflow framework
- **Mastra Inngest** (`@mastra/inngest`): Workflow orchestration integration
- **Mastra PostgreSQL** (`@mastra/pg`): Database integration
- **Mastra Memory** (`@mastra/memory`): Agent memory management
- **Inngest**: Background job processing and scheduling
- **Zod**: Runtime schema validation
- **Axios**: HTTP client for API calls
- **Pino**: Structured logging
- **node-telegram-bot-api**: Telegram integration

### Development Tools
- **TypeScript**: Type safety and compilation
- **tsx**: TypeScript execution
- **Prettier**: Code formatting
- **Mastra CLI**: Development server and build tools