import type { SupabaseClient } from '@supabase/supabase-js';
import { StreamWriter } from '../stream-writer.js';
import { setCwd, getCwd } from '../state.js';

export async function executeCwd(
  dir: string,
  commandId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const writer = new StreamWriter(commandId, supabase);

  if (!dir) {
    // No argument — just print current directory
    writer.write(getCwd());
  } else {
    const resolved = setCwd(dir);
    console.log(`  📂 cwd → ${resolved}`);
    writer.write(resolved);
  }

  await writer.end();
}
