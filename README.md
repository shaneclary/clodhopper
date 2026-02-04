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
- **Command cancellation** — cancel running commands from the web UI
- **Modular executors** — shell and Claude Code handlers, easy to extend
- **Connection status** — live indicator shows realtime link health
- **Mobile-first PWA** — installable, standalone dark-mode interface

## Setup

### 1. Supabase

Create a new Supabase project, then run the SQL in `supabase/schema.sql` in the SQL Editor.

Get your credentials from Project Settings → API:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (for the web app)
- `SUPABASE_SERVICE_KEY` (for the daemon — has full access)

### 2. Vercel (Web Interface)

```bash
cd web
npm install
vercel
```

Set environment variables in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AUTH_PIN` (simple PIN for auth, e.g., "1234")

### 3. Laptop Daemon

```bash
cd daemon
npm install

# Create .env file
cp .env.example .env
# Edit with your Supabase service key

# Run (keeps running, subscribes to realtime)
npm start
```

For persistent running:
```bash
# macOS — launch agent
cp dev.codhopper.daemon.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/dev.codhopper.daemon.plist

# Or use pm2
npm install -g pm2
pm2 start npm --name codhopper -- start
pm2 save
```

## Usage

1. Open the Vercel URL on your phone
2. Enter your PIN
3. Type a command:
   - `list files in ~/projects/myapp` — Claude Code prompt (default)
   - `claude: refactor the auth module` — explicit Claude Code
   - `shell: ls -la ~/projects` — direct shell command
4. Hit send — output streams back in real time
5. Tap **cancel** on any running command to stop it

## Commands

The daemon routes commands by prefix:

| Prefix | Executor | Timeout | Behavior |
|--------|----------|---------|----------|
| `shell:` | Bash | 5 min | Runs shell command, streams stdout+stderr |
| `claude:` | Claude Code CLI | 10 min | Sends prompt to `claude --print` |
| _(no prefix)_ | Claude Code CLI | 10 min | Default — treated as Claude prompt |

## Daemon Architecture

```
daemon/src/
  index.ts            — Entry point, Supabase realtime, command lifecycle
  executor.ts         — Command router (prefix → executor)
  types.ts            — Shared TypeScript interfaces
  stream-writer.ts    — Buffers output and flushes to Supabase in chunks
  process-manager.ts  — Tracks running processes for cancellation
  executors/
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

export function executeGit(
  args: string,
  commandId: string,
  supabase: SupabaseClient,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args.split(' '), { cwd: process.env.HOME });
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

Then add it to the executor registry:

```typescript
// daemon/src/executor.ts
import { executeGit } from './executors/git.js';

const executors: ExecutorEntry[] = [
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
