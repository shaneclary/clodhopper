# codhopper

Hop between devices. Control Claude Code on your laptop from your phone.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Phone/Web     │     │    Supabase     │     │     Laptop      │
│   (Vercel)      │     │                 │     │                 │
│                 │     │  ┌───────────┐  │     │  ┌───────────┐  │
│  ┌───────────┐  │     │  │ commands  │  │     │  │  daemon   │  │
│  │  text box │──┼────▶│  │  table    │──┼────▶│  │  (idle)   │  │
│  └───────────┘  │     │  └───────────┘  │     │  └─────┬─────┘  │
│                 │     │                 │     │        │        │
│  ┌───────────┐  │     │  ┌───────────┐  │     │        ▼        │
│  │ streaming │◀─┼─────│  │ responses │◀─┼─────│  ┌───────────┐  │
│  │  display  │  │     │  │ (chunks)  │  │     │  │  executor │  │
│  └───────────┘  │     │  └───────────┘  │     │  │  (stream) │  │
└─────────────────┘     └─────────────────┘     │  └───────────┘  │
                                                └─────────────────┘
```

**Key design:** The laptop daemon stays idle, subscribed to Supabase realtime. Only spins up when a command arrives. Output streams back in chunks via realtime — no polling, no wasted compute.

## Features

- **Streaming responses** — output appears in real time as commands execute
- **Working directory** — `cwd:` to point shell and Claude at any project
- **Command cancellation** — cancel running commands from the web UI
- **Modular executors** — shell, Claude Code, cwd, status — easy to extend
- **Connection status** — live indicator shows realtime link health
- **Mobile-first PWA** — installable, standalone dark-mode interface

## Quickstart

You need three things running: a Supabase project, the web app on Vercel, and the daemon on your laptop.

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `supabase/schema.sql`
3. Go to **Project Settings → API** and grab:
   - `SUPABASE_URL` (under Project URL)
   - `SUPABASE_ANON_KEY` (under `anon` `public`)
   - `SUPABASE_SERVICE_KEY` (under `service_role` `secret`)

### 2. Web app → Vercel

```bash
cd web
npm install
npx vercel
```

When prompted (or in the Vercel dashboard), set these environment variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `AUTH_PIN` | Any PIN you'll remember (e.g., `8472`) |

### 3. Daemon → Your laptop

```bash
cd daemon
npm install
cp .env.example .env
```

Edit `.env` with your Supabase credentials:
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

Start it:
```bash
npm start
```

You should see:
```
🦗 codhopper daemon starting...
📡 Supabase: https://xxxxx.supabase.co
📂 cwd: /Users/you
✅ Listening for commands...
💤 Idle — waiting for work
```

For persistent running:
```bash
# macOS — launch agent (edit YOUR_USERNAME first)
cp dev.codhopper.daemon.plist.example ~/Library/LaunchAgents/dev.codhopper.daemon.plist
launchctl load ~/Library/LaunchAgents/dev.codhopper.daemon.plist

# Or use pm2
npm install -g pm2
pm2 start npm --name codhopper -- start
pm2 save
```

### 4. Open your phone

1. Navigate to your Vercel URL
2. Enter your PIN
3. You're in — start sending commands

## Usage

A typical workflow from your phone:

```
you:    cwd: ~/projects/myapp
daemon: /Users/you/projects/myapp

you:    what does this project do?
daemon: This is a Next.js app that... (Claude reads your files and responds)

you:    shell: npm test
daemon: (streaming test output...)

you:    fix the failing test in auth.test.ts
daemon: (Claude analyzes the test and suggests a fix)

you:    shell: git diff
daemon: (shows what changed)

you:    status:
daemon: cwd      /Users/you/projects/myapp
        uptime   2h 15m
        active   0
```

## Commands

| Prefix | Executor | Timeout | What it does |
|--------|----------|---------|--------------|
| `cwd:` | Directory | instant | Set working directory for all commands |
| `status:` | Status | instant | Show daemon cwd, uptime, active processes |
| `shell:` | Bash | 5 min | Run a shell command, stream stdout+stderr |
| `claude:` | Claude Code CLI | 10 min | Send prompt to `claude --print` |
| _(no prefix)_ | Claude Code CLI | 10 min | Default — treated as Claude prompt |

Claude Code runs with `--print` in the current `cwd:` directory. It can read your project files, understand your codebase, and answer questions about it.

## Daemon Architecture

```
daemon/src/
  index.ts            — Entry point, realtime subscription, command lifecycle
  executor.ts         — Command router (prefix → executor)
  state.ts            — Daemon state (working directory, uptime)
  types.ts            — Shared TypeScript interfaces
  stream-writer.ts    — Buffers output, flushes to Supabase in chunks
  process-manager.ts  — Tracks running processes for cancellation
  executors/
    cwd.ts            — Working directory executor
    status.ts         — Daemon status executor
    shell.ts          — Shell command executor
    claude.ts         — Claude Code CLI executor
```

## Extending

Add a new executor in `daemon/src/executors/` and register it in `daemon/src/executor.ts`:

```typescript
// daemon/src/executors/git.ts
import { spawn } from 'child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { StreamWriter } from '../stream-writer.js';
import { processManager } from '../process-manager.js';
import { getCwd } from '../state.js';

export function executeGit(
  args: string,
  commandId: string,
  supabase: SupabaseClient,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args.split(' '), { cwd: getCwd() });
    processManager.register(commandId, proc);
    const writer = new StreamWriter(commandId, supabase);

    proc.stdout.on('data', (d: Buffer) => writer.write(d.toString()));
    proc.stderr.on('data', (d: Buffer) => writer.write(d.toString()));

    proc.on('close', async (code) => {
      processManager.unregister(commandId);
      if (!writer.hasContent) writer.write('(no output)');
      await writer.end(code !== 0);
      code === 0 ? resolve() : reject(new Error(`Exit code ${code}`));
    });
  });
}
```

Then register it:

```typescript
// daemon/src/executor.ts
import { executeGit } from './executors/git.js';

const executors: ExecutorEntry[] = [
  { name: 'cwd', prefix: 'cwd:', execute: executeCwd },
  { name: 'status', prefix: 'status:', execute: executeStatus },
  { name: 'shell', prefix: 'shell:', execute: executeShell },
  { name: 'claude', prefix: 'claude:', execute: executeClaude },
  { name: 'git', prefix: 'git:', execute: executeGit },
];
```

## Security Notes

- PIN auth uses timing-safe comparison — good enough for personal use behind HTTPS
- Service key on laptop has full DB access — don't expose it
- Commands run with your user permissions — be careful what you ask for
- Consider Tailscale if you want laptop → Supabase to be private network only
