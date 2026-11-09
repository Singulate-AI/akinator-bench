import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createBrain, GUESSER_PROMPT, MAX_QUESTIONS } from './brain.mjs';
import { createCharacter } from './character.mjs';
import { benchmarkFiles, readJson } from './data.mjs';
import { playCharacter } from './game.mjs';
import { configuredModels, createCompleter, models, modelSettings } from './models.mjs';

async function main() {
  const files = benchmarkFiles();
  const { values } = parseArgs({
    options: {
      model: { type: 'string', multiple: true },
      character: { type: 'string', multiple: true },
      concurrency: { type: 'string', default: '5' },
      output: { type: 'string', default: files.results },
      resume: { type: 'boolean' },
    },
  });
  const { output } = values;
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error('--concurrency must be an integer from 1 to 10.');
  }

  const characters = await readJson(files.characters);
  const modelIds = models.map(({ id }) => id);
  const characterIds = characters.map(({ id }) => id);
  for (const [key, ids] of [['model', modelIds], ['character', characterIds]]) {
    const unknown = values[key]?.find((id) => !ids.includes(id));
    if (unknown !== undefined) throw new Error(`Unknown ${key} "${unknown}". Choose from: ${ids.join(', ')}.`);
  }

  const env = process.env;
  const configured = new Set(configuredModels(env).map(({ id }) => id));
  const selectedModels = values.model
    ? modelIds.filter((id) => values.model.includes(id))
    : modelIds.filter((id) => configured.has(id));
  if (!selectedModels.length) throw new Error('Configure a provider before running the benchmark.');
  const selectedCharacters = characters.filter(({ id }) => !values.character || values.character.includes(id));
  const cases = selectedCharacters.flatMap((character) => selectedModels.map((model) => ({ model, character })));
  const plan = cases.map(({ model, character }) => ({ model, character: character.id }));
  const answerers = Object.fromEntries(selectedModels.map((id) => [id, id === 'sol' ? 'opus' : 'sol']));
  const activeModelIds = [...new Set([...selectedModels, ...Object.values(answerers)])];
  const missing = activeModelIds.filter((id) => !configured.has(id));
  if (missing.length) throw new Error(`Configure provider access for: ${missing.join(', ')}.`);
  const settings = {
    answerers, maxQuestions: MAX_QUESTIONS, guesserPrompt: GUESSER_PROMPT,
    models: Object.fromEntries(activeModelIds.map((id) => [id, modelSettings(env, id)])),
  };
  const report = values.resume
    ? await readJson(output)
    : { startedAt: new Date().toISOString(), plan, settings, results: [] };
  if (JSON.stringify(report.plan) !== JSON.stringify(plan) ||
      JSON.stringify(report.settings) !== JSON.stringify(settings)) {
    throw new Error('Resume requires the same character selection, model configuration, and prompt as the saved run.');
  }

  const keyOf = ({ model, character }) => `${model}/${character}`;
  const results = new Map(report.results.map((result) => [keyOf(result), result]));
  const pending = cases.filter(({ model, character }) => {
    const prior = results.get(keyOf({ model, character: character.id }));
    return !prior || prior.status === 'error';
  });
  const complete = createCompleter(env);
  const brain = createBrain(complete);
  const players = { sol: createCharacter(complete), opus: createCharacter(complete, 'opus') };

  await mkdir(dirname(output), { recursive: true });
  if (!values.resume) {
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }

  let cursor = 0;
  let checkpoint = Promise.resolve();
  async function worker() {
    while (cursor < pending.length) {
      const { model, character } = pending[cursor++];
      const result = await playCharacter(brain, players[answerers[model]], model, character);
      results.set(keyOf(result), result);

      // One writer keeps parallel games from overwriting each other's completed results.
      checkpoint = checkpoint.then(async () => {
        report.results = plan.flatMap((item) => results.has(keyOf(item)) ? [results.get(keyOf(item))] : []);
        await writeFile(`${output}.${process.pid}.tmp`, JSON.stringify(report, null, 2) + '\n');
        await rename(`${output}.${process.pid}.tmp`, output);
      });
      await checkpoint;

      const detail = result.error ?? (result.guess || 'no guess');
      console.log(`${model} / ${character.id}: ${result.status} in ${result.questions} question(s) (${detail})`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  for (const model of selectedModels) {
    const rows = report.results.filter((row) => row.model === model);
    const correct = rows.filter((row) => row.status === 'correct');
    const errors = rows.filter((row) => row.status === 'error').length;
    const mean = correct.reduce((sum, row) => sum + row.questions, 0) / correct.length;
    console.log(`${model}: ${correct.length}/${rows.length} correct, ${errors} errors, ${correct.length ? mean.toFixed(1) : '-'} mean questions on correct guesses`);
  }

  if (report.results.some(({ status }) => status === 'error')) process.exitCode = 1;
  console.log(`Results: ${output}`);
}

main().catch((error) => {
  console.error(error.code === 'EEXIST' ? 'Output already exists. Use --resume or a new --output path.' : error.message);
  process.exitCode = 1;
});
