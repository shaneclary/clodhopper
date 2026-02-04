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
│  │  results  │◀─┼─────│  │ responses │◀─┼─────│  ┌───────────┐  │
│  │  display  │  │     │  │  table    │  │     │  │   Claude  │  │
│  └───────────┘  │     │  └───────────┘  │     │  │   Code    │  │
└─────────────────┘     └─────────────────┘     │  └───────────┘  │
                                                └─────────────────┘
```

**Key design:** The laptop daemon stays idle, subscribed to Supabase realtime. Only spins up Claude when a command arrives. No wasted compute.

## Setup

### 1. Supabase

Create a new Supabase project, then run the SQL in `supabase/schema.sql` in the SQL Editor.

Get your credentials from Project Settings → API:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (for the web app)
- `SUPABASE_SERVICE_KEY` (for the daemon - has full access)

### 2. Vercel (Web Interface)

```bash
# Clone and deploy
cd web
npm install
vercel
```

Set environment variables in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AUTH_SECRET` (generate with `openssl rand -base64 32`)
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
# macOS - launch agent
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
3. Type a command like:
   - `list files in ~/projects/mothership`
   - `run tests in the current project`
   - `claude: refactor the auth module to use middleware`
4. Hit send
5. Watch the response stream back

## Security Notes

- PIN auth is basic - good enough for personal use behind HTTPS
- Service key on laptop has full DB access - don't expose it
- Commands run with your user permissions - be careful what you ask for
- Consider Tailscale if you want laptop → Supabase to be private network only

## Commands

The daemon understands these prefixes:
- `claude:` - Sends to Claude Code CLI
- `shell:` - Runs shell command directly
- (no prefix) - Treated as Claude Code prompt

## Extending

Want to add more capabilities? Edit `daemon/src/executor.ts`:

```typescript
// Add new command types
if (command.startsWith('git:')) {
  return executeGit(command.slice(4));
}
```
