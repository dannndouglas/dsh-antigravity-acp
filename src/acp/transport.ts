import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  type ClientConnection,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
/** The same SDK framing/correlation/validation used by dsh-subagent-acp. */
export function connectTransport(
  input: Readable,
  output: Writable,
  onUpdate: (event: SessionNotification) => void,
  onPermission: () => void,
): ClientConnection {
  const app = client({ name: 'dsh-antigravity-acp' })
    .onNotification(methods.client.session.update, ({ params }) => {
      onUpdate(params);
    })
    .onRequest(methods.client.session.requestPermission, () => {
      // Always answer before scheduling teardown; never select an allow option.
      queueMicrotask(onPermission);
      return { outcome: { outcome: 'cancelled' } };
    });
  return app.connect(
    ndJsonStream(
      Writable.toWeb(output) as WritableStream<Uint8Array>,
      Readable.toWeb(input) as ReadableStream<Uint8Array>,
    ),
  );
}
