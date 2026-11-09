import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function benchmarkFiles() {
  return {
    characters: new URL('./data/characters.json', import.meta.url),
    baselines: new URL('./data/baselines.json', import.meta.url),
    reference: new URL('./data/reference-results.json', import.meta.url),
    results: fileURLToPath(new URL('./runs/results.json', import.meta.url)),
  };
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
