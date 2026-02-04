import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';

// Validate env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface Command {
  id: string;
  content: string;
  status: string;
}

// Track in-flight commands to avoid double-processing
const processing = new Set<string>();

async function executeCommand(command: Command) {
  if (processing.has(command.id)) return;
  processing.add(command.id);

  console.log(`\n📥 Received command: ${command.content.slice(0, 50)}...`);

  // Mark as running
  await supabase
    .from('commands')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', command.id);

  try {
    const content = command.content.trim();
    let result: string;

    if (content.startsWith('shell:')) {
      // Direct shell command
      result = await runShell(content.slice(6).trim());
    } else if (content.startsWith('claude:')) {
      // Claude Code with specific prompt
      result = await runClaudeCode(content.slice(7).trim());
    } else {
      // Default: treat as Claude Code prompt
      result = await runClaudeCode(content);
    }

    // Send final response
    await supabase.from('responses').insert({
      command_id: command.id,
      content: result,
      chunk_index: 0,
      is_error: false,
    });

    // Mark completed
    await supabase
      .from('commands')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', command.id);

    console.log(`✅ Command completed: ${command.id}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await supabase.from('responses').insert({
      command_id: command.id,
      content: `Error: ${errorMsg}`,
      chunk_index: 0,
      is_error: true,
    });

    await supabase
      .from('commands')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', command.id);

    console.error(`❌ Command failed: ${errorMsg}`);
  } finally {
    processing.delete(command.id);
  }
}

function runShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`🐚 Running shell: ${cmd}`);

    const proc = spawn('bash', ['-c', cmd], {
      cwd: process.env.HOME,
      env: process.env as NodeJS.ProcessEnv,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout || '(no output)');
      } else {
        reject(new Error(stderr || `Exit code ${code}`));
      }
    });

    proc.on('error', reject);

    // Timeout after 5 minutes
    setTimeout(() => {
      proc.kill();
      reject(new Error('Command timed out (5 min)'));
    }, 5 * 60 * 1000);
  });
}

function runClaudeCode(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`🤖 Running Claude Code: ${prompt.slice(0, 50)}...`);

    // Use claude CLI with --print flag for non-interactive output
    const proc = spawn('claude', ['--print', prompt], {
      cwd: process.env.HOME,
      env: process.env as NodeJS.ProcessEnv,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout || '(no output)');
      } else {
        // Claude might exit non-zero but still have useful output
        resolve(stdout || stderr || `Exit code ${code}`);
      }
    });

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
          )
        );
      } else {
        reject(err);
      }
    });

    // Timeout after 10 minutes for Claude (can be slow)
    setTimeout(() => {
      proc.kill();
      reject(new Error('Claude Code timed out (10 min)'));
    }, 10 * 60 * 1000);
  });
}

async function processBacklog() {
  // Check for any pending commands on startup
  const { data: pending } = await supabase
    .from('commands')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (pending && pending.length > 0) {
    console.log(`📋 Found ${pending.length} pending commands`);
    for (const cmd of pending) {
      await executeCommand(cmd);
    }
  }
}

async function main() {
  console.log('🦗 codhopper daemon starting...');
  console.log(`📡 Connected to: ${SUPABASE_URL}`);

  // Process any backlog first
  await processBacklog();

  // Subscribe to new commands via realtime
  const channel = supabase
    .channel('daemon-commands')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'commands',
      },
      (payload) => {
        const command = payload.new as Command;
        if (command.status === 'pending') {
          executeCommand(command);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Listening for commands...');
        console.log('💤 Daemon idle - waiting for work\n');
      }
    });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down...');
    await channel.unsubscribe();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n👋 Shutting down...');
    await channel.unsubscribe();
    process.exit(0);
  });
}

main().catch(console.error);
