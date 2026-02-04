import { spawn } from 'child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { StreamWriter } from '../stream-writer.js';
import { processManager } from '../process-manager.js';

const TIMEOUT = 10 * 60 * 1000; // 10 minutes

export function executeClaude(
  prompt: string,
  commandId: string,
  supabase: SupabaseClient,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`  🤖 claude: ${prompt.slice(0, 60)}...`);

    const proc = spawn('claude', ['--print', prompt], {
      cwd: process.env.HOME,
      env: process.env as NodeJS.ProcessEnv,
    });

    processManager.register(commandId, proc);
    const writer = new StreamWriter(commandId, supabase);

    let done = false;
    let timedOut = false;

    proc.stdout.on('data', (data: Buffer) => writer.write(data.toString()));
    proc.stderr.on('data', (data: Buffer) => writer.write(data.toString()));

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, TIMEOUT);
    timer.unref();

    proc.on('close', async (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      processManager.unregister(commandId);

      if (signal) {
        await writer.end();
        reject(
          new Error(
            timedOut ? 'Claude Code timed out (10 min)' : 'Command cancelled',
          ),
        );
        return;
      }

      // Claude may exit non-zero but still produce useful output
      if (!writer.hasContent) writer.write('(no output)');
      await writer.end();
      resolve();
    });

    proc.on('error', async (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      processManager.unregister(commandId);

      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            'Claude CLI not found. Install: npm i -g @anthropic-ai/claude-code',
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}
