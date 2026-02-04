import type { ChildProcess } from 'child_process';

class ProcessManager {
  private processes = new Map<string, ChildProcess>();

  register(commandId: string, proc: ChildProcess): void {
    this.processes.set(commandId, proc);
  }

  unregister(commandId: string): void {
    this.processes.delete(commandId);
  }

  kill(commandId: string): boolean {
    const proc = this.processes.get(commandId);
    if (!proc) return false;

    proc.kill('SIGTERM');

    // Force kill after 5 seconds if still alive
    const forceKill = setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 5000);

    // Don't keep the process alive just for the timer
    forceKill.unref();

    this.processes.delete(commandId);
    return true;
  }

  get activeCount(): number {
    return this.processes.size;
  }
}

export const processManager = new ProcessManager();
