import { applyExternalChecks } from './common.mjs';
export async function runScenario(probe) {
  const allowed = probe.input.gate.mode === 'device' ? ['physical-device'] : ['automated-test','migration-rehearsal','operations-rehearsal','staging-rehearsal'];
  applyExternalChecks(probe, probe.input, probe.input.gate.checks, allowed);
}
