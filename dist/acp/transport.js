import { Readable, Writable } from 'node:stream';
import { client, methods, ndJsonStream, } from '@agentclientprotocol/sdk';
/** The same SDK framing/correlation/validation used by dsh-subagent-acp. */
export function connectTransport(input, output, onUpdate, onPermission) {
    const app = client({ name: 'dsh-antigravity-acp' })
        .onNotification(methods.client.session.update, ({ params }) => {
        onUpdate(params);
    })
        .onRequest(methods.client.session.requestPermission, () => {
        // Always answer before scheduling teardown; never select an allow option.
        queueMicrotask(onPermission);
        return { outcome: { outcome: 'cancelled' } };
    });
    return app.connect(ndJsonStream(Writable.toWeb(output), Readable.toWeb(input)));
}
