const byId = (id) => document.getElementById(id);

const play = byId("play");
const resultsView = byId("results");
const playButton = byId("play-view");
const resultsButton = byId("results-view");
const setupForm = byId("setup-form");
const modelSelect = byId("model");
const startButton = byId("start-game");
const resetButton = byId("reset-game");
const answerControls = byId("answer-controls");
const guessControls = byId("guess-controls");
const roundTitle = byId("round-title");
const gameStatus = byId("game-status");
const gameError = byId("game-error");
const retryButton = byId("retry-game");
const resultsStatus = byId("results-status");
const resultsError = byId("results-error");
const refreshButton = byId("refresh-results");

let models = [];
let modelsRequest;
let game;
let pending = false;
let retry;

function restingMood() {
  if (!game) return "idle";
  return game.outcome ?? (game.guess ? "reveal" : "asking");
}

async function request(path, body) {
  const options = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  if (!data) throw new Error("The server returned an invalid response.");
  return data;
}

function hideGameError() {
  gameError.hidden = true;
  retry = undefined;
}

function showGameError(error, action) {
  byId("game-error-text").textContent = error.message;
  gameError.hidden = false;
  retry = action;
}

function setPending(value, message = "") {
  pending = value;
  modelSelect.disabled = value || models.length === 0;
  startButton.disabled = modelSelect.disabled;
  resetButton.disabled = value;
  retryButton.disabled = value;
  for (const button of answerControls.querySelectorAll("button")) {
    button.disabled = value;
  }
  gameStatus.textContent = message;
  byId("stage").dataset.mood = value ? "thinking" : restingMood();
}

function loadModels() {
  if (modelsRequest) return modelsRequest;

  modelsRequest = request("/api/models").then((data) => {
    models = data.models;
    const options = models.map(({ id, label }) => new Option(label, id));
    modelSelect.replaceChildren(...(options.length ? options : [new Option("No live models configured", "")]));
    modelSelect.disabled = pending || !models.length;
    startButton.disabled = modelSelect.disabled;
    hideGameError();
  }).catch((error) => {
    modelSelect.replaceChildren(new Option("Models unavailable", ""));
    modelsRequest = undefined;
    throw error;
  });

  return modelsRequest;
}

async function loadSetup() {
  hideGameError();
  setPending(true, "Loading models...");
  try {
    await loadModels();
  } catch (error) {
    showGameError(error, loadSetup);
  } finally {
    setPending(false, models.length ? "" : "Open Results to view the recorded benchmark.");
  }
}

function gameHeading() {
  const count = byId("question-count");
  const model = models.find(({ id }) => id === modelSelect.value);
  byId("console-label").textContent = model.label;
  count.textContent = `${game.questions} ${game.questions === 1 ? "question" : "questions"}`;
  count.hidden = false;
  resetButton.hidden = false;
}

function renderRound() {
  byId("setup").hidden = true;
  byId("round").hidden = false;
  gameHeading();

  const kicker = byId("round-kicker");
  kicker.textContent = game.guess ? "First guess" : game.done ? "Game over" : "Your turn";
  roundTitle.textContent = game.guess || (game.done ? "The model ran out of questions." : game.question);
  answerControls.hidden = game.done || Boolean(game.guess);
  guessControls.hidden = !game.guess;
  if (!play.hidden) roundTitle.focus();
}

async function advanceGame(path, body, recordAnswer) {
  if (pending) return;
  hideGameError();
  setPending(true, "The model is thinking...");
  try {
    const nextGame = await request(path, body);
    if (recordAnswer) recordAnswer();
    game = nextGame;
    renderRound();
  } catch (error) {
    showGameError(error, () => advanceGame(path, body, recordAnswer));
  } finally {
    setPending(false);
    if (retry && !play.hidden) retryButton.focus();
  }
}

function addTurn(question, answer) {
  const turn = document.createElement("li");
  const response = document.createElement("strong");
  response.textContent = answer;
  turn.append(question, " ", response);
  byId("turns").append(turn);
  byId("history").hidden = false;
}

function resetGame() {
  game = undefined;
  byId("stage").dataset.mood = "idle";
  hideGameError();
  byId("setup").hidden = false;
  byId("round").hidden = true;
  byId("console-label").textContent = "Live game";
  byId("question-count").hidden = true;
  resetButton.hidden = true;
  byId("verdict").hidden = true;
  const history = byId("history");
  history.hidden = true;
  history.open = false;
  byId("turns").replaceChildren();
  modelSelect.focus();
}

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  advanceGame("/api/games", { model: modelSelect.value });
});
modelSelect.addEventListener("change", hideGameError);

answerControls.addEventListener("click", (event) => {
  const button = event.target.closest("[data-answer]");
  if (!button || !game || game.done || game.guess) return;
  const question = game.question;
  const body = { answer: button.dataset.answer, questions: game.questions };
  advanceGame(`/api/games/${encodeURIComponent(game.id)}/answer`, body, () => {
    addTurn(question, button.textContent);
  });
});

guessControls.addEventListener("click", (event) => {
  const button = event.target.closest("[data-verdict]");
  if (!button) return;
  const verdict = byId("verdict");
  verdict.textContent = `${button.dataset.verdict} first guess.`;
  verdict.hidden = false;
  guessControls.hidden = true;
  game.outcome = button.dataset.verdict === "Correct" ? "right" : "wrong";
  byId("stage").dataset.mood = game.outcome;
  roundTitle.focus();
});

resetButton.addEventListener("click", resetGame);
retryButton.addEventListener("click", () => retry?.());

const statusLabels = {
  correct: "Correct",
  incorrect: "Incorrect",
  unavailable: "Unavailable",
  error: "Error",
  exhausted: "No guess",
};
const answerLabels = {
  yes: "Yes",
  no: "No",
  probably: "Probably",
  probably_not: "Probably not",
  dont_know: "Don't know",
};
const MISS_QUESTION_COST = 50;
const BASELINE_ID = "official";

const gameDialog = byId("game-dialog");
let benchmark;

function gamesLink(text, modelId, characterId) {
  const link = document.createElement("a");
  const path = [modelId, characterId].filter(Boolean).map(encodeURIComponent).join("/");
  link.href = `#games/${path}`;
  link.textContent = text;
  return link;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badgeFor(result) {
  const badge = element("span", "badge", result ? (statusLabels[result.status] || result.status) : "Pending");
  if (result?.status === "correct" || result?.status === "incorrect") {
    badge.dataset.status = result.status;
  }
  return badge;
}

function gameSummary(result) {
  const count = Number.isInteger(result?.questions) ? `${result.questions}Q` : "";
  const detail = result?.detailsWithheld ? "Details withheld" : result?.guess;
  return [detail, count].filter(Boolean).join(" / ");
}

function cellFor(row, result, modelId, characterId) {
  const cell = row.insertCell();
  cell.append(badgeFor(result));

  const summary = gameSummary(result);
  if (summary) {
    const detail = element("p", "cell-detail");
    detail.append(result.history?.length ? gamesLink(summary, modelId, characterId) : summary);
    cell.append(detail);
  }
}

function correctCount({ entries }, characters) {
  return characters.filter(({ id }) => entries.get(id)?.status === "correct").length;
}

function modelGamesView(column) {
  const { characters } = benchmark;
  const games = element("ul", "game-list");
  for (const { id, name } of characters) {
    const result = column.entries.get(id);
    const item = element("li");
    const title = element("span", "game-list-name");
    title.append(result?.history?.length ? gamesLink(name, column.id, id) : name);
    item.append(title, badgeFor(result), element("span", "game-list-detail", gameSummary(result)));
    games.append(item);
  }
  return [
    element("h2", "", column.label),
    element("p", "game-summary", `${correctCount(column, characters)} of ${characters.length} correct guesses. Choose a character to read its questions and answers.`),
    games,
  ];
}

function gameView(column, character) {
  const result = column.entries.get(character.id);
  const back = element("p", "game-back");
  back.append(gamesLink(`All games for ${column.label}`, column.id));

  const count = `${result.questions} ${result.questions === 1 ? "question" : "questions"}`;
  const outcome = result.detailsWithheld
    ? `used ${count}`
    : result.guess ? `guessed ${result.guess} after ${count}` : `made no guess after ${count}`;
  const summary = element("p", "game-summary");
  summary.append(badgeFor(result), ` ${column.label} ${outcome}.`);

  const turns = element("ol", "game-turns");
  for (const { question, answer } of result.history ?? []) {
    const turn = element("li");
    turn.append(element("span", "", question), element("strong", "", answerLabels[answer] || answer));
    turns.append(turn);
  }

  const view = [back, element("h2", "", character.name), summary];
  if (column.id === BASELINE_ID) {
    view.push(element("p", "game-note", "The official game's log records paraphrased question topics, not exact wording."));
  }
  const missingLog = result.detailsWithheld ? "The transcript is withheld for privacy." : "No questions were recorded for this game.";
  view.push(result.history?.length ? turns : element("p", "game-note", missingLog));
  return view;
}

function clearGameHash() {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function route() {
  const [, modelId, characterId] = location.hash.match(/^#games\/([^/]+)(?:\/([^/]+))?$/) ?? [];
  if (!modelId) {
    if (gameDialog.open) gameDialog.close();
    return;
  }
  if (!benchmark) {
    if (resultsView.hidden) showView(true);
    return;
  }

  const column = benchmark.columns.find(({ id }) => encodeURIComponent(id) === modelId);
  const character = benchmark.characters.find(({ id }) => encodeURIComponent(id) === characterId);
  const hasGame = character && column?.entries.has(character.id);
  if (!column || (characterId && !hasGame)) {
    clearGameHash();
    if (gameDialog.open) gameDialog.close();
    return;
  }

  byId("game-body").replaceChildren(...(characterId ? gameView(column, character) : modelGamesView(column)));
  const title = byId("game-body").querySelector("h2");
  title.id = "game-title";
  title.tabIndex = -1;
  if (!gameDialog.open) gameDialog.showModal();
  gameDialog.scrollTop = 0;
  title.focus();
}

function renderScoreboard(columns, characters) {
  const scores = columns.map((column) => {
    const { label, entries, baseline, id } = column;
    const trials = characters.map(({ id }) => entries.get(id));
    const scored = trials.filter((trial) => trial?.status === "correct" || trial?.status === "incorrect");
    const total = scored.length === characters.length && scored.length > 0
      ? scored.reduce((sum, trial) => sum + (trial.status === "correct" ? trial.questions : MISS_QUESTION_COST), 0)
      : null;
    return { id, label, total, baseline, correct: correctCount(column, characters) };
  });
  scores.sort((a, b) => (a.total ?? Number.MAX_SAFE_INTEGER) - (b.total ?? Number.MAX_SAFE_INTEGER));

  const rows = scores.map(({ id, label, total, baseline, correct }) => {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = label;
    if (baseline) {
      const tag = document.createElement("span");
      tag.className = "baseline-tag";
      tag.textContent = "Score to beat";
      row.className = "baseline";
      name.append(tag);
    }
    row.append(name);
    const correctLink = gamesLink(`${correct} of ${characters.length}`, id);
    correctLink.setAttribute("aria-label", `${correct} of ${characters.length} correct guesses for ${label}. View games.`);
    row.insertCell().append(correctLink);
    row.insertCell().textContent = total ?? "Pending";
    return row;
  });
  byId("model-scores").replaceChildren(...rows);
}

function renderResults(data) {
  const columns = [{ id: BASELINE_ID, label: "Official Akinator", entries: new Map(Object.entries(data.baselines)), baseline: true }];
  for (const model of data.models) {
    const entries = data.results
      .filter((result) => result.model === model.id)
      .map((result) => [result.character, result]);
    columns.push({ id: model.id, label: model.label, entries: new Map(entries) });
  }

  const header = document.createElement("tr");
  for (const label of ["Character", ...columns.map(({ label }) => label)]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    header.append(th);
  }
  byId("score-head").replaceChildren(header);

  const rows = data.characters.map(({ id, name }) => {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = name;
    row.append(th);
    for (const { id: modelId, entries } of columns) cellFor(row, entries.get(id), modelId, id);
    return row;
  });
  byId("score-body").replaceChildren(...rows);

  benchmark = { columns, characters: data.characters };
  renderScoreboard(columns, data.characters);
  byId("results-content").hidden = false;
  if (!data.results.length) {
    resultsStatus.textContent = "Run the batch benchmark to add model scores.";
  } else {
    resultsStatus.textContent = data.usesCurrentPrompt ? "" : "These model scores use earlier game rules.";
  }
}

async function loadResults() {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  resultsError.hidden = true;
  resultsStatus.textContent = "Loading results...";
  try {
    renderResults(await request("/api/results"));
    route();
  } catch (error) {
    resultsStatus.textContent = "";
    resultsError.textContent = error.message;
    resultsError.hidden = false;
  } finally {
    refreshButton.disabled = false;
  }
}

function showView(showResults) {
  play.hidden = showResults;
  resultsView.hidden = !showResults;
  playButton.setAttribute("aria-pressed", String(!showResults));
  resultsButton.setAttribute("aria-pressed", String(showResults));
  if (showResults) {
    byId("results-title").focus();
    loadResults();
  }
}

playButton.addEventListener("click", () => showView(false));
resultsButton.addEventListener("click", () => showView(true));
refreshButton.addEventListener("click", loadResults);
addEventListener("hashchange", route);
gameDialog.addEventListener("close", clearGameHash);
gameDialog.addEventListener("click", (event) => {
  if (event.target === gameDialog) gameDialog.close();
});

loadSetup();
route();
