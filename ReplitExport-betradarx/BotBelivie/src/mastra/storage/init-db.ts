import pg from "pg";

/**
 * Initialize database tables for adaptive learning football bot
 * Run this to set up the schema
 */
export async function initDatabase() {
  const connectionString =
    process.env.DATABASE_URL || "postgresql://localhost:5432/mastra";
  
  const client = new pg.Client({ connectionString });
  
  try {
    await client.connect();
    await client.query("BEGIN");

    // Create alerts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS football_alerts (
        id SERIAL PRIMARY KEY,
        fixture_id INTEGER NOT NULL,
        minute INTEGER NOT NULL,
        press_total DECIMAL(10, 2) NOT NULL,
        press_diff DECIMAL(10, 2) NOT NULL,
        corners INTEGER NOT NULL,
        shots_on_goal INTEGER NOT NULL,
        goals_at_alert INTEGER NOT NULL DEFAULT 0,
        goal_happened BOOLEAN DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Migration: Add goals_at_alert column if it doesn't exist
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'football_alerts' 
          AND column_name = 'goals_at_alert'
        ) THEN
          ALTER TABLE football_alerts 
          ADD COLUMN goals_at_alert INTEGER NOT NULL DEFAULT 0;
          
          -- Mark all existing alerts as already verified (we can't get historical baselines)
          -- This prevents corrupting accuracy calculations with invalid historical data
          UPDATE football_alerts 
          SET goal_happened = NULL 
          WHERE goal_happened IS NULL AND created_at < NOW() - INTERVAL '10 minutes';
        END IF;
      END $$;
    `);

    // Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_fixture_minute 
      ON football_alerts(fixture_id, minute)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_alerts_created_at 
      ON football_alerts(created_at)
    `);

    // Create thresholds table (singleton row)
    await client.query(`
      CREATE TABLE IF NOT EXISTS football_thresholds (
        id INTEGER PRIMARY KEY DEFAULT 1,
        threshold_total DECIMAL(10, 2) NOT NULL DEFAULT 70,
        threshold_diff DECIMAL(10, 2) NOT NULL DEFAULT 15,
        escanteios_10min INTEGER NOT NULL DEFAULT 3,
        last_updated TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT single_row CHECK (id = 1)
      )
    `);

    // Insert default thresholds if not exists
    await client.query(`
      INSERT INTO football_thresholds (id, threshold_total, threshold_diff, escanteios_10min)
      VALUES (1, 70, 15, 3)
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query("COMMIT");
    console.log("✅ Database tables initialized successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error initializing database:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Auto-initialize on import
initDatabase().catch(console.error);
