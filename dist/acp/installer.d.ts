export declare const SERVER_VERSION = "1.3.0";
export declare function distribution(platform?: string, arch?: string): {
    key: string;
    command: string;
    url: string;
};
export interface InstallOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    notify?: (message: string) => void;
    cacheRoot?: string;
    platform?: string;
    arch?: string;
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}
export declare function ensureOfficialServer(options?: InstallOptions): Promise<string>;
