import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Buffers process output and flushes to Supabase responses table in chunks.
 * Uses a promise chain to ensure sequential writes.
 */
export class StreamWriter {
  private buffer = '';
  private chunkIndex = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushQueue: Promise<void> = Promise.resolve();

  private static readonly FLUSH_INTERVAL = 300; // ms
  private static readonly FLUSH_SIZE = 1024; // bytes - flush immediately at this size

  constructor(
    private commandId: string,
    private supabase: SupabaseClient,
  ) {}

  write(data: string): void {
    this.buffer += data;

    if (this.buffer.length >= StreamWriter.FLUSH_SIZE) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, StreamWriter.FLUSH_INTERVAL);
    }
  }

  private flush(isError = false): void {
    if (this.buffer.length === 0) return;

    const content = this.buffer;
    const idx = this.chunkIndex++;
    this.buffer = '';

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushQueue = this.flushQueue.then(async () => {
      const { error } = await this.supabase.from('responses').insert({
        command_id: this.commandId,
        content,
        chunk_index: idx,
        is_error: isError,
      });
      if (error) {
        console.error(`  Stream write error [chunk ${idx}]:`, error.message);
      }
    });
  }

  async end(isError = false): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length > 0) {
      this.flush(isError);
    }
    await this.flushQueue;
  }

  get hasContent(): boolean {
    return this.chunkIndex > 0 || this.buffer.length > 0;
  }
}
