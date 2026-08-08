export const stripUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
    ) as T;
  }

  return value;
};
