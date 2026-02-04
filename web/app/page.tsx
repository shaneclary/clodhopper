'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Command {
  id: string;
  content: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
}

interface Response {
  id: string;
  command_id: string;
  content: string;
  chunk_index: number;
  is_error: boolean;
}

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [input, setInput] = useState('');
  const [commands, setCommands] = useState<Command[]>([]);
  const [responses, setResponses] = useState<Record<string, Response[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

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

    // Load recent commands
    loadRecentCommands();

    // Subscribe to new commands
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
                cmd.id === payload.new.id ? (payload.new as Command) : cmd
              )
            );
          }
        }
      )
      .subscribe();

    // Subscribe to responses
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
        }
      )
      .subscribe();

    channelRef.current = commandChannel;

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
      .limit(20);

    if (cmds) {
      setCommands(cmds.reverse());

      // Load responses for these commands
      const ids = cmds.map((c) => c.id);
      const { data: resps } = await supabase
        .from('responses')
        .select('*')
        .in('command_id', ids)
        .order('chunk_index', { ascending: true });

      if (resps) {
        const grouped = resps.reduce((acc, r) => {
          if (!acc[r.command_id]) acc[r.command_id] = [];
          acc[r.command_id].push(r);
          return acc;
        }, {} as Record<string, Response[]>);
        setResponses(grouped);
      }
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });

    if (res.ok) {
      localStorage.setItem('codhopper-auth', 'true');
      setIsAuthenticated(true);
    } else {
      alert('Invalid PIN');
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
      alert('Failed to send command');
    }

    setIsLoading(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'running':
        return '⚡';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      default:
        return '❓';
    }
  };

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

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Header */}
      <header className="bg-zinc-900 p-4 border-b border-zinc-800">
        <h1 className="text-lg font-semibold text-white text-center">
          codhopper
        </h1>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {commands.map((cmd) => (
          <div key={cmd.id} className="space-y-2">
            {/* Command */}
            <div className="flex justify-end">
              <div className="bg-blue-600 text-white px-4 py-2 rounded-2xl rounded-br-md max-w-[85%]">
                <p className="whitespace-pre-wrap">{cmd.content}</p>
              </div>
            </div>

            {/* Response */}
            <div className="flex justify-start">
              <div className="bg-zinc-800 text-zinc-100 px-4 py-2 rounded-2xl rounded-bl-md max-w-[85%]">
                <div className="flex items-center gap-2 mb-1 text-xs text-zinc-400">
                  <span>{getStatusIcon(cmd.status)}</span>
                  <span>{cmd.status}</span>
                </div>
                {responses[cmd.id]?.length > 0 ? (
                  <pre className="whitespace-pre-wrap font-mono text-sm">
                    {responses[cmd.id].map((r) => (
                      <span
                        key={r.id}
                        className={r.is_error ? 'text-red-400' : ''}
                      >
                        {r.content}
                      </span>
                    ))}
                  </pre>
                ) : cmd.status === 'pending' || cmd.status === 'running' ? (
                  <span className="text-zinc-500 italic">Waiting...</span>
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
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 p-3 bg-zinc-800 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-xl font-semibold transition-colors"
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
      </form>
    </main>
  );
}
