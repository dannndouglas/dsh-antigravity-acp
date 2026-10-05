import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DshMcpBridge } from '../src/mcp/bridge.js';
const live: DshMcpBridge[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(live.splice(0).map((b) => b.close()));
});
async function fixture(
  onCall = async (call: { name: string; arguments: string }) => ({
    content: [{ type: 'text' as const, text: call.name + call.arguments }],
  }),
) {
  const bridge = new DshMcpBridge(
    [
      {
        name: 'workspace.read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ],
    onCall,
  );
  live.push(bridge);
  const descriptor = await bridge.start();
  const client = new Client({ name: 'test', version: '1' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: Object.fromEntries(descriptor.headers.map((h) => [h.name, h.value])),
      },
    }),
  );
  return { bridge, client, descriptor };
}
describe('local MCP bridge', () => {
  it('preserves the DSH tool name and exact arguments across an official MCP transport', async () => {
    const { client } = await fixture();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    const result = await client.callTool({ name: tools[0]!.name, arguments: { path: 'α.txt' } });
    expect(result.content).toEqual([{ type: 'text', text: 'workspace.read{"path":"α.txt"}' }]);
  });
  it('rejects invalid arguments without dispatching a harness call', async () => {
    let count = 0;
    const { client } = await fixture(async () => {
      count++;
      return { content: [] };
    });
    const { tools } = await client.listTools();
    expect((await client.callTool({ name: tools[0]!.name, arguments: { path: 7 } })).isError).toBe(
      true,
    );
    expect((await client.callTool({ name: 'unknown', arguments: {} })).isError).toBe(true);
    expect(count).toBe(0);
  });
  it('authenticates every request and rejects browser origins', async () => {
    const { descriptor } = await fixture();
    expect((await fetch(descriptor.url, { method: 'POST' })).status).toBe(401);
    expect(
      (
        await fetch(descriptor.url, {
          method: 'POST',
          headers: {
            ...Object.fromEntries(descriptor.headers.map((h) => [h.name, h.value])),
            Origin: 'https://example.org',
          },
        })
      ).status,
    ).toBe(403);
  });
  it('requires exact official MCP metadata for permission routing', async () => {
    const { bridge, client } = await fixture();
    const name = (await client.listTools()).tools[0]!.name;
    expect(
      bridge.owns({ _meta: { mcp: { server: 'dsh-bridge', tool: name }, is_mcp_tool_call: true } }),
    ).toBe(true);
    expect(bridge.owns({ _meta: { mcp: { server: 'evil', tool: name } } })).toBe(false);
    expect(bridge.owns({ title: `dsh-bridge_${name}` })).toBe(false);
  });
  it('creates distinct names for colliding normalized DSH names and rejects duplicate names', async () => {
    const b = new DshMcpBridge(
      ['a.b', 'a_b'].map((name) => ({ name, description: name, parameters: { type: 'object' } })),
      async () => ({ content: [] }),
    );
    live.push(b);
    expect(new Set(b.tools.map((t) => t.mcpName)).size).toBe(2);
    expect(
      () =>
        new DshMcpBridge(
          [
            { name: 'x', description: '', parameters: {} },
            { name: 'x', description: '', parameters: {} },
          ],
          async () => ({ content: [] }),
        ),
    ).toThrow();
  });
});
