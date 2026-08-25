export function buildTotpMfaUpdate(currentConfig, adjacentIntervals) {
  const current = currentConfig?.multiFactorConfig;
  const providers = Array.isArray(current?.providerConfigs) ? current.providerConfigs : [];
  const existingTotp = providers.find((provider) => provider?.totpProviderConfig);
  const alreadyEnabled = current?.state === 'ENABLED'
    && existingTotp?.state === 'ENABLED'
    && existingTotp.totpProviderConfig?.adjacentIntervals === adjacentIntervals;

  if (alreadyEnabled) return { changed: false };

  return {
    changed: true,
    multiFactorConfig: {
      state: 'ENABLED',
      ...(Array.isArray(current?.factorIds) && current.factorIds.length
        ? { factorIds: [...current.factorIds] }
        : {}),
      providerConfigs: [
        ...providers.filter((provider) => !provider?.totpProviderConfig),
        {
          state: 'ENABLED',
          totpProviderConfig: { adjacentIntervals },
        },
      ],
    },
  };
}
