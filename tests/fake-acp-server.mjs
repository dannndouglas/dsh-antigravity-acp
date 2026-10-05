import { createInterface } from 'node:readline';
const variant = process.argv[2] ?? 'normal';
let sessions = 0,
  authCalls = 0,
  active = new Map(),
  cancelled = new Set();
const send = (x) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...x }) + '\n');
const update = (sessionId, update) =>
  send({ method: 'session/update', params: { sessionId, update } });
const configOptions = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'fake-model',
    options: [
      { value: 'fake-model', name: 'Fake Model' },
      { value: 'other-model', name: 'Other Model' },
    ],
  },
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'yolo', name: 'YOLO' },
    ],
  },
];
createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  if (!m.method) return;
  const { id, method, params: p } = m;
  const ok = (result) => send({ id, result });
  if (method === 'initialize') {
    if (variant === 'init-hang') return;
    return ok({
      protocolVersion: variant === 'v2' ? 2 : 1,
      agentCapabilities: { auth: { logout: {} } },
      authMethods: [{ id: 'oauth-personal', name: 'Google' }],
      agentInfo: { name: 'fake-acp', version: 'test' },
    });
  }
  if (method === 'authenticate') {
    authCalls++;
    return ok({});
  }
  if (method === 'logout') return ok({});
  if (method === 'session/new') {
    if (variant === 'auth' && !authCalls)
      return send({ id, error: { code: -32000, message: 'Authentication required' } });
    return ok({ sessionId: 's' + ++sessions, configOptions });
  }
  if (method === 'session/set_config_option') return ok({ configOptions });
  if (method === 'session/cancel') {
    cancelled.add(p.sessionId);
    if (variant !== 'ignore-cancel') {
      const rid = active.get(p.sessionId);
      if (rid) send({ id: rid, result: { stopReason: 'cancelled' } });
    }
    return;
  }
  if (method === 'session/prompt') {
    if (variant === 'error')
      return send({ id, error: { code: -32602, message: 'secret test credential must not leak' } });
    if (variant === 'disconnect') return process.exit(7);
    active.set(p.sessionId, id);
    if (variant === 'hang') return;
    if (variant === 'ignore-cancel' && !p.prompt[0].text.includes('RECOVER')) {
      update(p.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'waiting' },
      });
      return;
    }
    const sid = p.sessionId;
    update('unrelated', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'WRONG' },
    });
    if (variant === 'tools') {
      update(sid, {
        sessionUpdate: 'tool_call',
        toolCallId: 'native-tool',
        title: 'Read file',
        kind: 'read',
        status: 'pending',
      });
      return;
    }
    if (variant === 'permission') {
      send({
        id: 'permission-1',
        method: 'session/request_permission',
        params: {
          sessionId: sid,
          toolCall: {
            toolCallId: 'native-tool',
            title: 'Run command',
            kind: 'execute',
            status: 'pending',
          },
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
        },
      });
      return;
    }
    update(sid, {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Thinking' },
    });
    // Split within a multibyte character and in the middle of the JSON frame.
    const bytes = Buffer.from(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: sid,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Olá ' } },
        },
      }) + '\n',
    );
    const split = bytes.indexOf(Buffer.from('á')) + 1;
    process.stdout.write(bytes.subarray(0, split));
    await new Promise((r) => setTimeout(r, 15));
    process.stdout.write(bytes.subarray(split));
    await new Promise((r) => setTimeout(r, 80));
    if (cancelled.has(sid)) return ok({ stopReason: 'cancelled' });
    const prompt = p.prompt[0].text;
    update(sid, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: variant === 'echo' ? prompt : 'world' },
    });
    update(sid, { sessionUpdate: 'usage_update', used: 25, size: 200000 });
    ok({ stopReason: variant === 'refusal' ? 'refusal' : 'end_turn' });
  }
});
process.stdin.on('end', () => process.exit(0));
