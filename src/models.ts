import type {
  NewSessionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
} from '@agentclientprotocol/sdk';
export function selectValues(option: SessionConfigOption): SessionConfigSelectOption[] {
  if (option.type !== 'select') return [];
  return option.options.flatMap((entry) => ('options' in entry ? entry.options : [entry]));
}
export function modelOption(session: NewSessionResponse): SessionConfigOption | undefined {
  return (
    session.configOptions?.find((c) => c.category === 'model') ??
    session.configOptions?.find((c) => c.id === 'model')
  );
}
export function modelCatalog(session: NewSessionResponse): { id: string; name: string }[] {
  const option = modelOption(session);
  if (option) return selectValues(option).map((c) => ({ id: c.value, name: c.name }));
  return []; // Never rely on the deprecated/unstable models extension.
}
