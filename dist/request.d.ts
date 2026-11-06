import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
export type AcpGenerateOptions = Omit<GenerateOptions, 'purpose'> & {
    purpose?: string;
};
