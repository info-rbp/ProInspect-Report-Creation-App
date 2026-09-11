import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acceptance } from '../adapter-sdk.mjs';
import { requireThat,root,safePath } from '../runtime.mjs';

const probe=acceptance();
const scenarioPath=probe.input.scenarioFile;
requireThat(typeof scenarioPath==='string' && (scenarioPath.startsWith('infrastructure/launch-scenarios/') || scenarioPath.startsWith('infrastructure/upgrades/launch-readiness-v2/scenarios/')) && scenarioPath.endsWith('.mjs'),'A reviewed tracked scenario module is required');
const file=safePath(root,scenarioPath);
const scenario=await import(`${pathToFileURL(file).href}?run=${encodeURIComponent(probe.input.runId)}`);
requireThat(typeof scenario.runScenario==='function','Scenario module must export runScenario');
await scenario.runScenario({
  input: probe.input,
  evidenceDirectory: dirname(process.env.PROINSPECT_LAUNCH_OUTPUT),
  check: probe.check,
  artifact: probe.artifact,
});
probe.finish();
