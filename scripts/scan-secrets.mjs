import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const candidates = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
if (candidates.status !== 0) {
  throw new Error('Unable to enumerate repository files for secret scanning.');
}
const repositoryFiles = [...new Set(candidates.stdout.split('\0').filter(Boolean))];

const allowedExampleValues = /^(?:|password|change-me|example|placeholder|test-only|not-a-real-password|\$\{[^}]+\}|<[^>]+>)$/iu;
const privateCredentialPatterns = [
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { name: 'Google service-account document', pattern: /"type"\s*:\s*"service_account"/u },
  { name: 'Google OAuth client secret', pattern: /GOCSPX-[A-Za-z0-9_-]{20,}/u },
  { name: 'GitHub access token', pattern: /gh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}/u },
  { name: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/u },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/u },
];
const assignmentPattern = /\b(password|passwd|client_secret|private_key|origin_secret|access_token|refresh_token)\b\s*[:=]\s*(['"])([^'"\r\n]*)\2/giu;
const findings = [];

for (const path of repositoryFiles) {
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (contents.includes('\0')) continue;

  for (const candidate of privateCredentialPatterns) {
    const match = candidate.pattern.exec(contents);
    if (match) {
      findings.push({ path, line: contents.slice(0, match.index).split('\n').length, kind: candidate.name });
    }
  }

  for (const match of contents.matchAll(assignmentPattern)) {
    const value = match[3].trim();
    if (!allowedExampleValues.test(value)) {
      findings.push({
        path,
        line: contents.slice(0, match.index).split('\n').length,
        kind: `hard-coded ${match[1].toLowerCase()}`,
      });
    }
  }
}

if (findings.length) {
  console.error('Potential committed secrets detected. Values are intentionally not printed.');
  for (const finding of findings) console.error(`${finding.path}:${finding.line} ${finding.kind}`);
  process.exit(1);
}

console.log(`Secret scan passed for ${repositoryFiles.length} tracked and untracked repository files.`);
