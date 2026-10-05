import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  type ClientConnection,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
/** The same SDK framing/correlation/validation used by dsh-subagent-acp. */
export function connectTransport(
  input: Readable,
  output: Writable,
  onUpdate: (event: SessionNotification) => void,
  onPermission: (request: RequestPermissionRequest) => void | RequestPermissionResponse,
): ClientConnection {
  const app = client({ name: 'dsh-antigravity-acp' })
    .onNotification(methods.client.session.update, ({ params }) => {
      onUpdate(params);
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      return onPermission(params) ?? { outcome: { outcome: 'cancelled' } };
    });
  return app.connect(
    ndJsonStream(
      Writable.toWeb(output) as WritableStream<Uint8Array>,
      Readable.toWeb(input) as ReadableStream<Uint8Array>,
    ),
  );
}
