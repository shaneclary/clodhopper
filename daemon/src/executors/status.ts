import type { SupabaseClient } from '@supabase/supabase-js';
import { StreamWriter } from '../stream-writer.js';
import { getCwd, getUptime } from '../state.js';
import { processManager } from '../process-manager.js';

export async function executeStatus(
  _input: string,
  commandId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const writer = new StreamWriter(commandId, supabase);
  writer.write(
    [
      `cwd      ${getCwd()}`,
      `uptime   ${getUptime()}`,
      `active   ${processManager.activeCount}`,
    ].join('\n'),
  );
  await writer.end();
}
