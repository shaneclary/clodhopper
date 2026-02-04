import type { SupabaseClient } from '@supabase/supabase-js';
import { executeShell } from './executors/shell.js';
import { executeClaude } from './executors/claude.js';

type ExecuteFn = (
  input: string,
  commandId: string,
  supabase: SupabaseClient,
) => Promise<void>;

interface ExecutorEntry {
  name: string;
  prefix: string;
  execute: ExecuteFn;
}

const executors: ExecutorEntry[] = [
  { name: 'shell', prefix: 'shell:', execute: executeShell },
  { name: 'claude', prefix: 'claude:', execute: executeClaude },
];

/**
 * Routes a command to the appropriate executor based on its prefix.
 * Commands without a recognized prefix default to Claude Code.
 */
export function routeCommand(content: string): {
  executor: ExecutorEntry;
  input: string;
} {
  const trimmed = content.trim();

  for (const executor of executors) {
    if (trimmed.startsWith(executor.prefix)) {
      return {
        executor,
        input: trimmed.slice(executor.prefix.length).trim(),
      };
    }
  }

  // Default: treat as Claude Code prompt
  return {
    executor: executors.find((e) => e.name === 'claude')!,
    input: trimmed,
  };
}
