// In demo mode, stub external AI calls so a public demo can't burn through
// API spend. Returns a canned Claude-shaped response that downstream code
// reads as "no signal worth changing the plan." Strava is OAuth-gated, so
// nothing to stub there — without a token, calls already short-circuit.

const DEMO_BLOCKED_HOSTS = ['api.anthropic.com'];

export function installDemoFetchGuard(): void {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })();

    if (DEMO_BLOCKED_HOSTS.includes(host)) {
      console.log('[demo] blocked external call to', host, url);
      return new Response(
        JSON.stringify({
          id: 'demo_stub',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '{"action":"hold","reason":"demo mode — coach is read-only"}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    return originalFetch(input, init);
  }) as typeof fetch;
}
