const permittedTypes = new Set(['web']);

export function validatePlatformDefinitions(platforms) {
  const errors = [];
  const ids = new Set();
  const hostnames = new Set();
  for (const platform of platforms) {
    if (!platform.$id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u.test(platform.$id)) {
      errors.push('Every Appwrite platform requires a valid source-controlled ID.');
    } else if (ids.has(platform.$id)) {
      errors.push(`Duplicate Appwrite platform ID: ${platform.$id}.`);
    }
    ids.add(platform.$id);
    if (!permittedTypes.has(platform.type)) errors.push(`Unsupported Appwrite platform type: ${platform.type}.`);
    if (!platform.name?.trim()) errors.push(`${platform.$id || 'Platform'} requires a name.`);
    const hostname = platform.hostname?.trim().toLowerCase();
    if (!hostname || hostname.includes('://') || hostname.includes('/') || hostname.includes(':')) {
      errors.push(`${platform.$id || 'Platform'} requires a hostname without scheme, path, or port.`);
    } else if (hostnames.has(hostname)) {
      errors.push(`Duplicate Appwrite platform hostname: ${hostname}.`);
    }
    hostnames.add(hostname);
    if (hostname && /production|prod\.|\.prod\b/iu.test(hostname)) {
      errors.push(`${platform.$id || 'Platform'} must not register a Production hostname from Development configuration.`);
    }
  }
  return errors;
}

export function platformDrift(expected, actual) {
  const expectedById = new Map(expected.map((item) => [item.$id, item]));
  const actualById = new Map(actual.map((item) => [item.$id, item]));
  const missing = expected.filter((item) => !actualById.has(item.$id));
  const extra = actual.filter((item) => !expectedById.has(item.$id));
  const incompatible = expected.flatMap((item) => {
    const remote = actualById.get(item.$id);
    if (!remote) return [];
    return remote.type !== item.type || remote.name !== item.name || remote.hostname !== item.hostname
      ? [{ expected: item, actual: remote }]
      : [];
  });
  return { missing, extra, incompatible };
}
