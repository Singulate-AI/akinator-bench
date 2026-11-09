import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBrain } from './brain.mjs';
import { createCharacter } from './character.mjs';
import { playCharacter } from './game.mjs';
import { configuredModels, createCompleter } from './models.mjs';
import { makeServer } from './server.mjs';

test('separates the evaluated model from the private character and scores recognized aliases', async () => {
  const character = {
    id: 'curie', name: 'Marie Curie', aliases: ['Maria Sklodowska-Curie'], profile: 'Chemist and physicist.',
  };
  const complete = async (model, { user }) => {
    const context = JSON.parse(user);
    if (model === 'sol') {
      assert.equal(context.character.profile, character.profile);
      return 'yes';
    }
    assert.equal(model, 'haiku');
    assert.doesNotMatch(user, /curie|chemist/i);
    return JSON.stringify(context.transcript.length
      ? { type: 'guess', text: 'Maria Sklodowska Curie' }
      : { type: 'question', text: 'Was this a real person?' });
  };

  const result = await playCharacter(createBrain(complete), createCharacter(complete), 'haiku', character);
  assert.equal(result.status, 'correct', result.error);
  assert.equal(result.questions, 1);
  assert.deepEqual(result.history, [{ question: 'Was this a real person?', answer: 'yes' }]);
});

const env = {
  AZURE__OPENAI_BASE: 'https://example.openai.azure.com/openai/v1/',
  AZURE__API_KEY: 'mock-azure',
  ANTHROPIC_API_KEY: 'mock-anthropic',
};
const formats = [
  {
    ids: ['sol', 'luna'], path: '/responses',
    effort: (body) => body.reasoning.effort,
    data: { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'reply' }] }] },
  },
  {
    ids: ['deepseek'], path: '/chat/completions', effort: () => undefined,
    data: { choices: [{ message: { reasoning_content: 'private', content: 'reply' } }] },
  },
  {
    ids: ['haiku', 'opus'], path: '/v1/messages',
    effort: (body) => body.output_config.effort,
    data: { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'reply' }] },
  },
];
const expectedEfforts = { sol: 'high', luna: 'medium', haiku: 'low', opus: 'high' };

for (const { ids, path, effort, data } of formats) {
  for (const id of ids) {
    test(`routes ${id} to the right API with its configured effort and extracts reply text`, async () => {
      const complete = createCompleter(env, async (url, options) => {
        assert.ok(url.endsWith(path));
        const isClaude = ids.includes('haiku');
        assert.equal(options.headers[isClaude ? 'x-api-key' : 'api-key'], isClaude ? 'mock-anthropic' : 'mock-azure');
        assert.equal(effort(JSON.parse(options.body)), expectedEfforts[id]);
        return Response.json(data);
      });
      assert.equal(await complete(id, { system: 'system', user: 'question' }), 'reply');
    });
  }
}

test('enables Gemini with OpenRouter credentials and retries an empty reply', async () => {
  const routerEnv = { OPENROUTER_API_KEY: 'mock-router' };
  const geminiIds = ['argon', 'gemini_flash', 'gemini_lite'];
  assert.ok(geminiIds.every(id => !configuredModels({}).some(model => model.id === id)));
  assert.ok(geminiIds.every(id => configuredModels(routerEnv).some(model => model.id === id)));

  let attempts = 0;
  const complete = createCompleter(routerEnv, async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer mock-router');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'google/gemini-3.5-flash-lite');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.tool_choice, 'none');
    assert.deepEqual(body.messages, [{ role: 'system', content: 'system' }, { role: 'user', content: 'question' }]);
    attempts++;
    const content = attempts === 1 ? null : 'reply';
    return Response.json({ choices: [{ message: { reasoning: 'private', content } }] });
  });
  assert.equal(await complete('gemini_lite', { system: 'system', user: 'question' }), 'reply');
  assert.equal(attempts, 2);
});

test('uses GPT-5 without forcing API JSON mode on the shared guesser prompt', async () => {
  const complete = createCompleter({ OPENROUTER_API_KEY: 'mock-router' }, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'openai/gpt-5');
    assert.equal(body.response_format, undefined);
    return Response.json({ choices: [{ message: { content: '{"type":"question","text":"Are they real?"}' } }] });
  });
  const move = await createBrain(complete).next('gpt5', []);
  assert.deepEqual(move, { type: 'question', text: 'Are they real?' });
});

test('serves the recorded questions and answers with the results', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bench-results-'));
  t.after(() => rm(directory, { recursive: true }));
  const results = join(directory, 'results.json');
  const history = [{ question: 'Is your character real?', answer: 'yes' }];
  await writeFile(results, JSON.stringify({
    results: [
      { model: 'haiku', character: 'curie', status: 'correct', questions: 1, guess: 'Marie Curie', history },
      { model: 'sol', character: 'curie', status: 'correct', questions: 1, guess: 'Marie Curie', history, detailsWithheld: true },
    ],
  }));
  const baselines = {
    curie: { status: 'incorrect', questions: 1, guess: 'Ada', transcript: [{ topic: 'Real person', answer: 'no' }] },
  };
  const characters = [{ id: 'curie', name: 'Marie Curie' }];
  const server = makeServer({ brain: {}, characters, baselines, files: { results }, models: [] });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/results`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.results[0].history, history);
  assert.deepEqual(data.results[1], {
    model: 'sol', character: 'curie', status: 'correct', questions: 1, guess: null, history: [], detailsWithheld: true,
  });
  assert.deepEqual(data.baselines.curie.history, [{ question: 'Real person', answer: 'no' }]);
});

test('keeps the question available after a failed request and replays a completed answer safely', async (t) => {
  let attempts = 0;
  const brain = {
    async next(model, history) {
      assert.equal(model, 'haiku');
      if (!history.length) return { type: 'question', text: 'Was this a real person?' };
      attempts++;
      if (attempts === 1) throw new Error('Provider unavailable.');
      assert.deepEqual(history, [{ question: 'Was this a real person?', answer: 'yes' }]);
      return { type: 'guess', text: 'Marie Curie' };
    },
  };
  const server = makeServer({ brain, characters: [], baselines: {}, models: configuredModels(env) });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function post(path, body) {
    return fetch(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  const start = await post('/api/games', { model: 'haiku' });
  assert.equal(start.status, 201);
  const game = await start.json();
  assert.equal(game.questions, 1);

  const path = `/api/games/${game.id}/answer`;
  const answer = { answer: 'yes', questions: 1 };
  const failed = await post(path, answer);
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'Provider unavailable.' });

  const solved = await post(path, answer);
  const retry = await post(path, answer);
  assert.equal(solved.status, 200);
  assert.equal(retry.status, 200);
  const final = { id: game.id, done: true, guess: 'Marie Curie', question: null, questions: 1 };
  assert.deepEqual(await solved.json(), final);
  assert.deepEqual(await retry.json(), final);
  assert.equal(attempts, 2);
});
