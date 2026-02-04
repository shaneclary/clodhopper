import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { routeCommand } from './executor.js';
import { processManager } from './process-manager.js';
import { getCwd } from './state.js';
import type { Command } from './types.js';

// --- Config ---

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- State ---

const processing = new Set<string>();
const cancelled = new Set<string>();

// --- Command execution ---

async function executeCommand(command: Command) {
  if (processing.has(command.id)) return;
  processing.add(command.id);

  console.log(`\n📥 Received: ${command.content.slice(0, 80)}`);

  // Atomically mark as running — only if still pending.
  // If the user cancelled before we started, this returns no rows.
  const { data: updated } = await supabase
    .from('commands')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', command.id)
    .eq('status', 'pending')
    .select()
    .single();

  if (!updated) {
    console.log(`  ⏭️  Skipped (no longer pending): ${command.id}`);
    processing.delete(command.id);
    return;
  }

  try {
    const { executor, input } = routeCommand(command.content);
    console.log(`  🔀 Executor: ${executor.name}`);

    await executor.execute(input, command.id, supabase);

    // Only mark completed if not already cancelled
    if (!cancelled.has(command.id)) {
      await supabase
        .from('commands')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', command.id)
        .eq('status', 'running');

      console.log(`  ✅ Completed: ${command.id}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    if (cancelled.has(command.id) || msg === 'Command cancelled') {
      cancelled.delete(command.id);
      // Status was already set to 'cancelled' by the web client
      console.log(`  🚫 Cancelled: ${command.id}`);
    } else {
      // Append error as a high-index response so it appears after streamed output
      await supabase.from('responses').insert({
        command_id: command.id,
        content: `Error: ${msg}`,
        chunk_index: 9999,
        is_error: true,
      });

      await supabase
        .from('commands')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', command.id);

      console.error(`  ❌ Failed: ${msg}`);
    }
  } finally {
    processing.delete(command.id);
    cancelled.delete(command.id);
  }
}

// --- Cancellation ---

function handleCancellation(commandId: string) {
  cancelled.add(commandId);

  if (processManager.kill(commandId)) {
    console.log(`  🚫 Killing process: ${commandId}`);
  }
}

// --- Backlog ---

async function processBacklog() {
  const { data: pending } = await supabase
    .from('commands')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (pending && pending.length > 0) {
    console.log(`📋 Backlog: ${pending.length} pending`);
    for (const cmd of pending) {
      await executeCommand(cmd);
    }
  }
}

// --- Main ---

async function main() {
  console.log('🦗 codhopper daemon starting...');
  console.log(`📡 Supabase: ${SUPABASE_URL}`);
  console.log(`📂 cwd: ${getCwd()}`);

  await processBacklog();

  const channel = supabase
    .channel('daemon-commands')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'commands' },
      (payload) => {
        const command = payload.new as Command;
        if (command.status === 'pending') {
          executeCommand(command);
        }
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'commands' },
      (payload) => {
        const command = payload.new as Command;
        if (command.status === 'cancelled') {
          handleCancellation(command.id);
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Listening for commands...');
        console.log('💤 Idle — waiting for work\n');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('⚠️  Channel error — Supabase will attempt reconnection');
      }
    });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n👋 Shutting down...');
    await channel.unsubscribe();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Don't crash on unhandled rejections
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
  });
}

main().catch(console.error);
