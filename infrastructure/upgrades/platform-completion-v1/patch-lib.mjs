import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { root } from './lib.mjs';

export function pathOf(path) {
  return resolve(root, path);
}

export function text(path) {
  return readFileSync(pathOf(path), 'utf8');
}

export function write(path, value) {
  const absolute = pathOf(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value.endsWith('\n') ? value : `${value}\n`);
}

export function writeIfChanged(path, value) {
  const next = value.endsWith('\n') ? value : `${value}\n`;
  const absolute = pathOf(path);
  if (existsSync(absolute) && readFileSync(absolute, 'utf8') === next) return false;
  write(path, next);
  return true;
}

export function replaceOnce(path, oldValue, newValue, label = oldValue.slice(0, 60)) {
  const source = text(path);
  if (source.includes(newValue)) return false;
  const first = source.indexOf(oldValue);
  if (first < 0) throw new Error(`${path}: could not locate ${label}.`);
  if (source.indexOf(oldValue, first + oldValue.length) >= 0) throw new Error(`${path}: ${label} is ambiguous.`);
  write(path, source.slice(0, first) + newValue + source.slice(first + oldValue.length));
  return true;
}

export function replaceRegexOnce(path, pattern, replacement, label) {
  const source = text(path);
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length === 0 && typeof replacement === 'string' && source.includes(replacement)) return false;
  if (matches.length !== 1) throw new Error(`${path}: expected one ${label}, found ${matches.length}.`);
  write(path, source.replace(pattern, replacement));
  return true;
}

export function insertAfter(path, anchor, addition, label = anchor.slice(0, 60)) {
  const source = text(path);
  if (source.includes(addition)) return false;
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`${path}: could not locate ${label}.`);
  write(path, source.slice(0, index + anchor.length) + addition + source.slice(index + anchor.length));
  return true;
}

export function insertBefore(path, anchor, addition, label = anchor.slice(0, 60)) {
  const source = text(path);
  if (source.includes(addition)) return false;
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`${path}: could not locate ${label}.`);
  write(path, source.slice(0, index) + addition + source.slice(index));
  return true;
}

export function ensureJsonScript(path, scripts) {
  const value = JSON.parse(text(path));
  value.scripts = { ...value.scripts, ...scripts };
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}
