-- Claude Remote Schema
-- Run this in Supabase SQL Editor

-- Commands table: stores incoming commands from the web interface
CREATE TABLE commands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Responses table: stores output chunks (streamed)
CREATE TABLE responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  command_id UUID REFERENCES commands(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER DEFAULT 0,
  is_error BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_commands_status ON commands(status);
CREATE INDEX idx_commands_created ON commands(created_at DESC);
CREATE INDEX idx_responses_command ON responses(command_id, chunk_index);

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE commands;
ALTER PUBLICATION supabase_realtime ADD TABLE responses;

-- RLS policies (basic - tighten for production)
ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert commands
CREATE POLICY "Anyone can insert commands" ON commands
  FOR INSERT WITH CHECK (true);

-- Allow reading all commands (for the web UI)
CREATE POLICY "Anyone can read commands" ON commands
  FOR SELECT USING (true);

-- Allow daemon to update command status (service role bypasses RLS anyway)
CREATE POLICY "Service can update commands" ON commands
  FOR UPDATE USING (true);

-- Allow daemon to insert responses
CREATE POLICY "Anyone can insert responses" ON responses
  FOR INSERT WITH CHECK (true);

-- Allow reading responses
CREATE POLICY "Anyone can read responses" ON responses
  FOR SELECT USING (true);

-- Function to clean up old commands (run via cron or manually)
CREATE OR REPLACE FUNCTION cleanup_old_commands()
RETURNS void AS $$
BEGIN
  DELETE FROM commands WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Optional: Auto-cleanup via pg_cron (if enabled in your Supabase project)
-- SELECT cron.schedule('cleanup-commands', '0 0 * * *', 'SELECT cleanup_old_commands()');
