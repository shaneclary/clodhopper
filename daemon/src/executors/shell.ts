import { spawn } from 'child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { StreamWriter } from '../stream-writer.js';
import { processManager } from '../process-manager.js';

const TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function executeShell(
  cmd: string,
  commandId: string,
  supabase: SupabaseClient,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`  🐚 shell: ${cmd}`);

    const proc = spawn('bash', ['-c', cmd], {
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
          new Error(timedOut ? 'Command timed out (5 min)' : 'Command cancelled'),
        );
        return;
      }

      if (code === 0) {
        if (!writer.hasContent) writer.write('(no output)');
        await writer.end();
        resolve();
      } else {
        await writer.end();
        reject(new Error(`Exit code ${code}`));
      }
    });

    proc.on('error', async (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      processManager.unregister(commandId);
      await writer.end(true);
      reject(err);
    });
  });
}
