import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { connectTransport } from '../src/acp/transport.js';
describe('SDK ACP transport regression contract', () => {
  it('correlates responses out of order, independent of notifications', async () => {
    const input = new PassThrough(),
      output = new PassThrough();
    const requests: any[] = [];
    const reader = createInterface({ input: output });
    reader.on('line', (s) => {
      requests.push(JSON.parse(s));
      if (requests.length === 2) {
        for (const r of [...requests].reverse())
          input.write(
            JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { value: r.params.value } }) + '\n',
          );
      }
    });
    const conn = connectTransport(
      input,
      output,
      () => {},
      () => {},
    );
    expect(
      await Promise.all([
        conn.agent.request('_echo', { value: 1 }),
        conn.agent.request('_echo', { value: 2 }),
      ]),
    ).toEqual([{ value: 1 }, { value: 2 }]);
    conn.close();
    reader.close();
    input.destroy();
    output.destroy();
  });
  it('rejects pending requests on disconnect', async () => {
    const input = new PassThrough(),
      output = new PassThrough();
    const conn = connectTransport(
      input,
      output,
      () => {},
      () => {},
    );
    const pending = conn.agent.request('_hang', {});
    const assertion = expect(pending).rejects.toThrow();
    input.end();
    await assertion;
    conn.close();
    output.destroy();
  });
  it('answers server-to-client permission requests without allowing tools', async () => {
    const input = new PassThrough(),
      output = new PassThrough();
    let denied = false;
    const conn = connectTransport(
      input,
      output,
      () => {},
      () => {
        denied = true;
      },
    );
    const response = new Promise<any>((resolve) =>
      createInterface({ input: output }).once('line', (s) => resolve(JSON.parse(s))),
    );
    input.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'permission',
        method: 'session/request_permission',
        params: {
          sessionId: 's',
          toolCall: { toolCallId: 't', title: 'Shell', status: 'pending' },
          options: [{ kind: 'allow_once', optionId: 'allow', name: 'Allow' }],
        },
      }) + '\n',
    );
    expect(await response).toEqual({
      jsonrpc: '2.0',
      id: 'permission',
      result: { outcome: { outcome: 'cancelled' } },
    });
    expect(denied).toBe(true);
    conn.close();
    input.destroy();
    output.destroy();
  });
});
