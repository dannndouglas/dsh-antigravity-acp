import { Readable, Writable } from 'node:stream';
import { type ClientConnection, type SessionNotification } from '@agentclientprotocol/sdk';
/** The same SDK framing/correlation/validation used by dsh-subagent-acp. */
export declare function connectTransport(input: Readable, output: Writable, onUpdate: (event: SessionNotification) => void, onPermission: () => void): ClientConnection;
