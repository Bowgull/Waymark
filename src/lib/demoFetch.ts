// In demo mode, stub external AI calls so a public demo can't burn through
// API spend. Returns canned Claude-shaped responses tailored per call site so
// the tour beats (Skip → coach replan, Replace → suggestions, Ledger insights)
// actually demonstrate the feature instead of returning a generic "hold."

const DEMO_BLOCKED_HOSTS = ['api.anthropic.com'];

type Stub = {
  match: (body: string) => boolean;
  text: string;
};

const STUBS: Stub[] = [
  {
    match: (b) => /ledger|insight|cinzel/i.test(b),
    text: JSON.stringify({
      insights: [
        { tone: 'observation', text: 'Three weeks of squat volume up, RPE flat. The body is absorbing the load.' },
        { tone: 'observation', text: 'Sleep under six hours twice this week. RPE on those days ran one point higher.' },
        { tone: 'observation', text: 'Easy runs holding zone two without HR drift. Aerobic base is doing its job.' },
      ],
    }),
  },
  {
    match: (b) => /replace|alternative|swap|suggestion/i.test(b),
    text: JSON.stringify({
      coachLine: 'Body is asking for less. Give it less without losing the day.',
      suggestions: [
        { type: 'mobility', label: 'Hip and T-spine flow', durationMin: 20, reason: 'Opens what the desk closed.' },
        { type: 'easy_run', label: 'Zone 2, 30 minutes', durationMin: 30, reason: 'Aerobic without taxing recovery.' },
        { type: 'active_recovery', label: 'Walk and breath work', durationMin: 25, reason: 'Parasympathetic recovery, no load.' },
      ],
    }),
  },
  {
    match: (b) => /reactive|skip|replan|adjust/i.test(b),
    text: JSON.stringify({
      action: 'shift',
      reason: 'Skipped session noted. Volume redistributed across the rest of the week.',
      adjustments: [
        { day: 'tomorrow', change: 'add 10 minutes mobility before strength' },
        { day: 'thursday', change: 'drop accessory volume by one set' },
      ],
    }),
  },
];

const FALLBACK = JSON.stringify({ action: 'hold', reason: 'demo mode — coach is read-only' });

export function installDemoFetchGuard(): void {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })();

    if (DEMO_BLOCKED_HOSTS.includes(host)) {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      const stub = STUBS.find((s) => s.match(bodyText));
      const text = stub ? stub.text : FALLBACK;

      console.log('[demo] stubbed', host, stub ? `(matched: ${stub.match.toString().slice(0, 50)})` : '(fallback)');

      return new Response(
        JSON.stringify({
          id: 'demo_stub',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return originalFetch(input, init);
  }) as typeof fetch;
}
