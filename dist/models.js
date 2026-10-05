export function selectValues(option) {
    if (option.type !== 'select')
        return [];
    return option.options.flatMap((entry) => ('options' in entry ? entry.options : [entry]));
}
export function modelOption(session) {
    return (session.configOptions?.find((c) => c.category === 'model') ??
        session.configOptions?.find((c) => c.id === 'model'));
}
export function modelCatalog(session) {
    const option = modelOption(session);
    if (option)
        return selectValues(option).map((c) => ({ id: c.value, name: c.name }));
    return []; // Never rely on the deprecated/unstable models extension.
}
