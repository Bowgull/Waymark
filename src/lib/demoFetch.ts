// In demo mode, stub external AI calls so a public demo can't burn through
// API spend. Returns canned Claude-shaped responses (text or tool_use) so
// the demo experience is identical to production without the spend.

const DEMO_BLOCKED_HOSTS = ['api.anthropic.com'];

type TextStub = { kind: 'text'; match: (body: string) => boolean; text: string };
type ToolStub = { kind: 'tool'; toolName: string; input: unknown };

const TEXT_STUBS: TextStub[] = [
  {
    kind: 'text',
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
    kind: 'text',
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
    kind: 'text',
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

// Tool-use stubs: matched by the requested tool_choice name in the body.
// Inputs match the shape declared in src/lib/prompts/tools.ts so the
// downstream getToolInput<T>() returns a valid object.
const TOOL_STUBS: Record<string, unknown> = {
  sessionReview: {
    line: 'Sixty minutes at RPE 7. Volume held, bar speed clean. The work is doing its job.',
    flag: 'none',
  },
  weekPlan: {
    narrative: 'Hold strength volume. Add one easy run to bring weekly aerobic time back to target.',
    mtSessionsThisWeek: 1,
    days: [
      { dayOfWeek: 1, sessions: [{ type: 'strength', timeSlot: 'pm', label: 'Lower strength', estimatedMin: 60 }] },
      { dayOfWeek: 2, sessions: [{ type: 'mobility', timeSlot: 'am', label: 'Mobility flow', estimatedMin: 25 }] },
      { dayOfWeek: 3, sessions: [{ type: 'strength', timeSlot: 'pm', label: 'Upper strength', estimatedMin: 60 }] },
      { dayOfWeek: 4, sessions: [{ type: 'run_outdoor', timeSlot: 'am', label: 'Easy zone 2', estimatedMin: 35, runCategory: 'zone2' }] },
      { dayOfWeek: 5, sessions: [{ type: 'mt_class', timeSlot: 'pm', label: 'MT class', estimatedMin: 90 }] },
      { dayOfWeek: 6, sessions: [{ type: 'active_recovery', timeSlot: 'am', label: 'Walk + breath', estimatedMin: 35 }] },
      { dayOfWeek: 0, sessions: [{ type: 'strength', timeSlot: 'pm', label: 'Full body + skip', estimatedMin: 60 }] },
    ],
  },
  bagPrescription: {
    sessionIntent: 'Sharp combinations, hands honest. Five rounds at controlled pace.',
    rounds: [
      { roundNumber: 1, roundType: 'warmup', rationale: 'Warm the shoulders and hips before loaded contact.', comboIds: [] },
      { roundNumber: 2, roundType: 'technical_flow', rationale: 'Move through the basics. Footwork first, then hands.', comboIds: [] },
      { roundNumber: 3, roundType: 'combo_practice', rationale: 'Pick two combos. Repeat clean reps over speed.', comboIds: [] },
      { roundNumber: 4, roundType: 'drill_isolation', rationale: 'Isolate the lead hand. Honest jab, sharp return.', comboIds: [] },
      { roundNumber: 5, roundType: 'conditioning', rationale: 'Finisher. Output stays high, technique stays clean.', comboIds: [] },
    ],
  },
};

function fakeToolUseBody(toolName: string, input: unknown): string {
  return JSON.stringify({
    id: 'demo_stub',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id: `toolu_demo_${Date.now()}`, name: toolName, input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

function fakeTextBody(text: string): string {
  return JSON.stringify({
    id: 'demo_stub',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

const FALLBACK_TEXT = JSON.stringify({ action: 'hold', reason: 'demo mode — coach is read-only' });

function detectToolChoice(body: string): string | null {
  // tool_choice: { type: 'tool', name: '<toolName>' }
  const m = body.match(/"tool_choice"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

export function installDemoFetchGuard(): void {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })();

    if (DEMO_BLOCKED_HOSTS.includes(host)) {
      const bodyText = typeof init?.body === 'string' ? init.body : '';

      const toolName = detectToolChoice(bodyText);
      if (toolName && TOOL_STUBS[toolName]) {
        console.log('[demo] stubbed tool_use', toolName);
        return new Response(fakeToolUseBody(toolName, TOOL_STUBS[toolName]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      const textStub = TEXT_STUBS.find((s) => s.match(bodyText));
      const text = textStub ? textStub.text : FALLBACK_TEXT;
      console.log('[demo] stubbed text', host, textStub ? '(matched)' : '(fallback)');
      return new Response(fakeTextBody(text), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return originalFetch(input, init);
  }) as typeof fetch;
}
