import type { GenerateOptions } from '@deepseek-ai/dsh-llm';

// DSH 0.2.2 declares purposes in producer packages. A forwarding adapter must
// accept every purpose, including ones supplied by host plugins we do not import.
// Omit also keeps this type compatible with the older, non-generic DSH contract.
export type AcpGenerateOptions = Omit<GenerateOptions, 'purpose'> & { purpose?: string };
