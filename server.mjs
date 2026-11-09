import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createBrain, GUESSER_PROMPT, MAX_QUESTIONS } from './brain.mjs';
import { ANSWERS } from './character.mjs';
import { benchmarkFiles, readJson } from './data.mjs';
import { configuredModels, createCompleter, models as modelCatalog } from './models.mjs';

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
const SESSION_LIFETIME_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 100;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new HttpError(415, 'Send an application/json request.');
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 1024) {
      request.resume();
      throw new HttpError(413, 'Request is too large.');
    }
    chunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks));
  } catch {
    throw new HttpError(400, 'Send valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Send a JSON object.');
  }
  return body;
}

function gameView({ id, history, move }) {
  const done = move.type !== 'question';
  return {
    id, done,
    question: done ? null : move.text,
    guess: move.type === 'guess' ? move.text : null,
    questions: history.length + Number(!done),
  };
}

export function makeServer({ brain, characters, baselines, files = benchmarkFiles(), models = configuredModels({}) }) {
  const games = new Map();

  async function startGame(model) {
    if (!models.some(({ id }) => id === model)) throw new HttpError(400, 'Choose a benchmark model.');

    for (const [id, game] of games) {
      if (!game.busy && Date.now() - game.updatedAt > SESSION_LIFETIME_MS) games.delete(id);
    }
    if (games.size >= MAX_SESSIONS) throw new HttpError(429, 'Game limit reached. Restart the local server.');

    const game = { id: randomUUID(), model, history: [], busy: true };
    games.set(game.id, game);
    try {
      game.move = await brain.next(model, []);
      game.updatedAt = Date.now();
      game.busy = false;
      return gameView(game);
    } catch (error) {
      games.delete(game.id);
      throw error;
    }
  }

  async function answerGame(id, { answer, questions }) {
    const game = games.get(id);
    if (!game || Date.now() - game.updatedAt > SESSION_LIFETIME_MS) {
      throw new HttpError(404, 'This game expired. Start a new game.');
    }
    if (!ANSWERS.includes(answer) || !Number.isInteger(questions)) {
      throw new HttpError(400, 'Choose a valid answer for the current question.');
    }

    // A retry after the response was lost returns the turn already paid for.
    if (questions === game.history.length && answer === game.history.at(-1)?.answer) {
      return gameView(game);
    }
    if (game.busy) throw new HttpError(409, 'A response is already in progress. Try again shortly.');
    if (game.move.type !== 'question' || questions !== game.history.length + 1) {
      throw new HttpError(409, 'This question has already been answered.');
    }

    game.busy = true;
    try {
      const history = [...game.history, { question: game.move.text, answer }];
      const move = await brain.next(game.model, history);
      Object.assign(game, { move, history, updatedAt: Date.now() });
      return gameView(game);
    } finally {
      game.busy = false;
    }
  }

  async function getResults() {
    let results = [];
    let usesCurrentPrompt = false;
    try {
      const report = await readJson(files.results);
      usesCurrentPrompt = report.settings?.guesserPrompt === GUESSER_PROMPT &&
        report.settings?.maxQuestions === MAX_QUESTIONS;
      results = report.results.map(({ model, character, status, questions, guess, detailsWithheld }) => ({
        model, character, status, questions, guess, detailsWithheld,
      }));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new HttpError(500, 'Could not read the benchmark results file.');
    }
    const names = characters.map(({ id, name }) => ({ id, name }));
    const baselineRows = baselines ?? await readJson(files.baselines);
    const scores = Object.fromEntries(Object.entries(baselineRows).map(([id, { status, questions, guess, detailsWithheld }]) => [
      id, { status, questions, guess, detailsWithheld },
    ]));
    const resultModels = modelCatalog.filter(({ id }) =>
      models.some((model) => model.id === id) || results.some((row) => row.model === id));
    return { characters: names, baselines: scores, results, models: resultModels, usesCurrentPrompt };
  }

  const server = createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const { port } = server.address();
    const host = request.headers.host;

    try {
      const suffix = port === 80 ? '' : `:${port}`;
      if (host !== `127.0.0.1${suffix}` && host !== `localhost${suffix}`) {
        throw new HttpError(403, 'Open the bench on localhost.');
      }
      if (request.headers.origin && request.headers.origin !== `http://${host}`) {
        throw new HttpError(403, 'Open the bench directly in your browser.');
      }

      const path = request.url.split('?')[0];
      const get = request.method === 'GET';
      const post = request.method === 'POST';
      if (get && Object.hasOwn(FILES, path)) {
        const [filename, type] = FILES[path];
        const content = await readFile(new URL(`./public/${filename}`, import.meta.url));
        response.writeHead(200, { 'content-type': type });
        response.end(content);
      } else if (get && path === '/api/models') {
        json(response, 200, { models, maxQuestions: MAX_QUESTIONS });
      } else if (get && path === '/api/results') {
        json(response, 200, await getResults());
      } else if (post && path === '/api/games') {
        const { model } = await readBody(request);
        json(response, 201, await startGame(model));
      } else if (post && /^\/api\/games\/[0-9a-f-]{36}\/answer$/.test(path)) {
        json(response, 200, await answerGame(path.split('/')[3], await readBody(request)));
      } else {
        throw new HttpError(404, 'Page not found.');
      }
    } catch (error) {
      if (error instanceof HttpError) json(response, error.status, { error: error.message });
      else json(response, 502, { error: error.message || 'Could not get a model response.' });
    }
  });
  return server;
}

async function main() {
  const port = Number(process.env.AKINATOR_PORT ?? 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set AKINATOR_PORT to a valid port.');
  const defaults = benchmarkFiles();
  const files = { ...defaults, results: process.env.AKINATOR_RESULTS_FILE || defaults.reference };
  const characters = await readJson(files.characters);
  const env = process.env;
  const brain = createBrain(createCompleter(env));
  const server = makeServer({ brain, characters, files, models: configuredModels(env) });
  server.listen(port, '127.0.0.1', () => console.log(`Akinator Bench at http://127.0.0.1:${port}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
