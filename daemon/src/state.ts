import { resolve } from 'path';
import { existsSync, statSync } from 'fs';

let currentCwd = process.env.HOME || '/';
const startedAt = new Date();

export function getCwd(): string {
  return currentCwd;
}

export function setCwd(dir: string): string {
  // Expand ~ to home directory
  const expanded = dir.replace(/^~(?=$|\/)/, process.env.HOME || '');
  const resolved = resolve(currentCwd, expanded);

  if (!existsSync(resolved)) {
    throw new Error(`Not found: ${resolved}`);
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  currentCwd = resolved;
  return currentCwd;
}

export function getUptime(): string {
  const ms = Date.now() - startedAt.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
