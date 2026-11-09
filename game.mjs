import { MAX_QUESTIONS } from './brain.mjs';

function normalizeName(name) {
  return name.normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export async function playCharacter(brain, player, model, character) {
  const startedAt = performance.now();
  const history = [];
  const result = { model, character: character.id, questions: 0, guess: null, history };

  try {
    while (true) {
      const move = await brain.next(model, history);
      if (move.type === 'exhausted') {
        return { ...result, status: 'incorrect', elapsedMs: Math.round(performance.now() - startedAt) };
      }
      if (move.type === 'guess') {
        const guess = normalizeName(move.text);
        const correct = [character.name, ...character.aliases].some((name) => normalizeName(name) === guess);
        return {
          ...result, status: correct ? 'correct' : 'incorrect', guess: move.text,
          elapsedMs: Math.round(performance.now() - startedAt),
        };
      }

      if (history.length === MAX_QUESTIONS) throw new Error('Akinator did not guess at the question limit.');
      result.questions++;
      const answer = await player.answer(character, history, move.text);
      history.push({ question: move.text, answer });
    }
  } catch (error) {
    return {
      ...result, status: 'error', error: error.message,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }
}
