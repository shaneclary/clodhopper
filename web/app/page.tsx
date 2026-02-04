'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// Fallbacks for build-time prerender — real values are always present at runtime
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
);

interface Command {
  id: string;
  content: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
}

interface Response {
  id: string;
  command_id: string;
  content: string;
  chunk_index: number;
  is_error: boolean;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [input, setInput] = useState('');
  const [commands, setCommands] = useState<Command[]>([]);
  const [responses, setResponses] = useState<Record<string, Response[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check for stored auth
  useEffect(() => {
    const stored = localStorage.getItem('codhopper-auth');
    if (stored === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  // Subscribe to realtime updates when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    loadRecentCommands();

    const commandChannel = supabase
      .channel('commands-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'commands' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setCommands((prev) => [...prev, payload.new as Command]);
          } else if (payload.eventType === 'UPDATE') {
            setCommands((prev) =>
              prev.map((cmd) =>
                cmd.id === payload.new.id ? (payload.new as Command) : cmd,
              ),
            );
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnectionStatus('connected');
        else if (
          status === 'CLOSED' ||
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT'
        )
          setConnectionStatus('disconnected');
      });

    const responseChannel = supabase
      .channel('responses-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'responses' },
        (payload) => {
          const newResponse = payload.new as Response;
          setResponses((prev) => ({
            ...prev,
            [newResponse.command_id]: [
              ...(prev[newResponse.command_id] || []),
              newResponse,
            ].sort((a, b) => a.chunk_index - b.chunk_index),
          }));
        },
      )
      .subscribe();

    return () => {
      commandChannel.unsubscribe();
      responseChannel.unsubscribe();
    };
  }, [isAuthenticated]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [commands, responses]);

  const loadRecentCommands = async () => {
    const { data: cmds } = await supabase
      .from('commands')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (cmds) {
      setCommands(cmds.reverse());

      const ids = cmds.map((c) => c.id);
      if (ids.length > 0) {
        const { data: resps } = await supabase
          .from('responses')
          .select('*')
          .in('command_id', ids)
          .order('chunk_index', { ascending: true });

        if (resps) {
          const grouped = resps.reduce(
            (acc, r) => {
              if (!acc[r.command_id]) acc[r.command_id] = [];
              acc[r.command_id].push(r);
              return acc;
            },
            {} as Record<string, Response[]>,
          );
          setResponses(grouped);
        }
      }
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });

    if (res.ok) {
      localStorage.setItem('codhopper-auth', 'true');
      setIsAuthenticated(true);
    } else {
      setPinError('Invalid PIN');
      setPin('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    const content = input.trim();
    setInput('');

    const { error } = await supabase
      .from('commands')
      .insert({ content, status: 'pending' });

    if (error) {
      console.error('Error inserting command:', error);
    }

    setIsLoading(false);
    inputRef.current?.focus();
  };

  const handleCancel = async (commandId: string) => {
    await supabase
      .from('commands')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', commandId)
      .in('status', ['pending', 'running']);
  };

  const handleLogout = () => {
    localStorage.removeItem('codhopper-auth');
    setIsAuthenticated(false);
    setCommands([]);
    setResponses({});
    setPin('');
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return '\u23f3';
      case 'running':
        return '\u26a1';
      case 'completed':
        return '\u2705';
      case 'failed':
        return '\u274c';
      case 'cancelled':
        return '\ud83d\udeab';
      default:
        return '\u2753';
    }
  };

  const getConnectionDot = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
        return 'bg-yellow-500 animate-pulse';
      case 'disconnected':
        return 'bg-red-500';
    }
  };

  // --- PIN screen ---

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <form
          onSubmit={handleAuth}
          className="bg-zinc-900 p-8 rounded-2xl shadow-2xl w-full max-w-sm"
        >
          <h1 className="text-2xl font-bold text-white mb-6 text-center">
            codhopper
          </h1>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter PIN"
            className="w-full p-4 bg-zinc-800 text-white rounded-xl text-center text-2xl tracking-widest mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {pinError && (
            <p className="text-red-400 text-sm text-center mb-4">{pinError}</p>
          )}
          <button
            type="submit"
            className="w-full p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors"
          >
            Unlock
          </button>
        </form>
      </main>
    );
  }

  // --- Main app ---

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Header */}
      <header className="bg-zinc-900 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getConnectionDot()}`} />
          <span className="text-xs text-zinc-500">{connectionStatus}</span>
        </div>
        <h1 className="text-lg font-semibold text-white">codhopper</h1>
        <button
          onClick={handleLogout}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          logout
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {commands.length === 0 && (
          <div className="flex items-center justify-center h-full text-center">
            <div className="space-y-3 px-4">
              <p className="text-zinc-400 text-sm font-medium">
                Ready to hop
              </p>
              <div className="text-zinc-600 text-xs space-y-1.5">
                <p>
                  <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
                    cwd: ~/projects/myapp
                  </code>{' '}
                  set project dir
                </p>
                <p>
                  <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
                    what does this project do?
                  </code>{' '}
                  ask Claude
                </p>
                <p>
                  <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
                    shell: npm test
                  </code>{' '}
                  run a command
                </p>
                <p>
                  <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
                    status:
                  </code>{' '}
                  check daemon state
                </p>
              </div>
            </div>
          </div>
        )}

        {commands.map((cmd) => (
          <div key={cmd.id} className="space-y-2">
            {/* Command bubble */}
            <div className="flex justify-end">
              <div className="bg-blue-600 text-white px-4 py-2 rounded-2xl rounded-br-md max-w-[85%]">
                <p className="whitespace-pre-wrap break-words">{cmd.content}</p>
              </div>
            </div>

            {/* Response bubble */}
            <div className="flex justify-start">
              <div className="bg-zinc-800 text-zinc-100 px-4 py-2 rounded-2xl rounded-bl-md max-w-[85%] min-w-[120px]">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <span>{getStatusIcon(cmd.status)}</span>
                    <span>{cmd.status}</span>
                  </div>
                  {(cmd.status === 'pending' || cmd.status === 'running') && (
                    <button
                      onClick={() => handleCancel(cmd.id)}
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-700"
                    >
                      cancel
                    </button>
                  )}
                </div>
                {responses[cmd.id]?.length > 0 ? (
                  <pre className="whitespace-pre-wrap font-mono text-sm break-words">
                    {responses[cmd.id].map((r) => (
                      <span
                        key={r.id}
                        className={r.is_error ? 'text-red-400' : ''}
                      >
                        {r.content}
                      </span>
                    ))}
                    {cmd.status === 'running' && (
                      <span className="inline-block w-2 h-4 bg-zinc-400 animate-blink ml-0.5 align-middle" />
                    )}
                  </pre>
                ) : cmd.status === 'pending' || cmd.status === 'running' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 italic">
                      {cmd.status === 'pending' ? 'Queued...' : 'Processing...'}
                    </span>
                    <span className="inline-block w-1.5 h-3 bg-zinc-500 animate-blink" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-4 bg-zinc-900 border-t border-zinc-800"
      >
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="shell: ls  or ask Claude anything..."
            className="flex-1 p-3 bg-zinc-800 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-600"
            disabled={isLoading}
            autoFocus
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-xl font-semibold transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </main>
  );
}
