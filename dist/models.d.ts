import type { NewSessionResponse, SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk';
export declare function selectValues(option: SessionConfigOption): SessionConfigSelectOption[];
export declare function modelOption(session: NewSessionResponse): SessionConfigOption | undefined;
export declare function modelCatalog(session: NewSessionResponse): {
    id: string;
    name: string;
}[];
