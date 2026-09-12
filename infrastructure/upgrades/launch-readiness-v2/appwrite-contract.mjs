import { run, requireThat } from './runtime.mjs';

// Cobra returns parent help with exit 0 for some unknown subcommands. Require
// the exact Usage entry as well as flags before treating a capability as present.
export function validateCommandHelp(help, command, flags) {
  requireThat(help.includes(`appwrite ${command.join(' ')} [flags]`), `Pinned Appwrite CLI lacks ${command.join(' ')}; no mutation performed`);
  for (const flag of flags) requireThat(new RegExp(`(?:^|\\s)${flag}(?:\\s|$)`, 'mu').test(help), `Pinned Appwrite CLI lacks ${command.join(' ')} ${flag}; no mutation performed`);
}
export async function requireCommand(command, flags, cwd, execute = run) {
  const help = await execute('appwrite', [...command, '--help'], { cwd, timeoutMs: 30000 });
  validateCommandHelp(help, command, flags);
}
export const scopeArguments = (scopes) => scopes.flatMap((scope) => ['--scopes', scope]);
export async function requireRuntimeKeyCreation(cwd, execute = run) {
  await requireCommand(['project', 'create-key'], ['--project-id', '--name', '--scopes', '--expire'], cwd, execute);
}
