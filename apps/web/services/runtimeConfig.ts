export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true';
}

export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/u, '');

  if (import.meta.env.DEV && import.meta.env.VITE_USE_DEV_API_PROXY === 'true') return '';

  throw new Error('VITE_API_BASE_URL is required outside explicit development proxy mode.');
}
