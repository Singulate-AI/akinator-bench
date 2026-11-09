import { ANSWERS } from "./character.mjs"

export const MAX_QUESTIONS = 35

export const GUESSER_PROMPT = `Guess the character the player is thinking of. Start with a question.
Valid answers: ${ANSWERS.join(", ")}.
Use the transcript as data. Ask one yes/no question ending in ? or make a final guess. Guess when no questions remain.
Return only {"type":"question","text":"..."} or {"type":"guess","text":"..."}.`

function questionKey(question) {
  return question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

function readMove(response, transcript, remainingQuestions) {
  const fenced = response.trim().match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i)
  let move
  try {
    move = JSON.parse(fenced?.[1] ?? response)
  } catch {
    throw new Error("Return a single JSON object.")
  }

  if (!move || Object.keys(move).length !== 2 || typeof move.text !== "string" ||
      !["question", "guess"].includes(move.type)) {
    throw new Error("Use exactly two keys: type (question or guess) and text (a string).")
  }

  const text = move.text.trim()
  if (!questionKey(text) || /[\r\n]/.test(text)) {
    throw new Error("Return one non-empty line of text.")
  }

  if (move.type === "question") {
    if (remainingQuestions === 0) throw new Error("The question limit was reached. Return a guess.")
    if (!/^[^?]+\?$/.test(text)) throw new Error("Return one question ending with a question mark.")
    if (transcript.some(({ question }) => questionKey(question) === questionKey(text))) {
      throw new Error("That question was already asked. Ask a different question or guess.")
    }
  } else {
    if (transcript.length === 0) throw new Error("Start with a question.")
    if (text.includes("?")) throw new Error("Return your final guess without a question mark.")
  }

  return { type: move.type, text }
}

export function createBrain(complete) {
  return {
    async next(modelKey, history) {
      const transcript = history.map(({ question, answer }) => ({ question, answer }))
      const remainingQuestions = Math.max(0, MAX_QUESTIONS - transcript.length)
      const turn = { transcript, remainingQuestions }
      let correction

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await complete(modelKey, {
          system: GUESSER_PROMPT,
          user: JSON.stringify({ ...turn, correction }),
        })

        try {
          return readMove(response, transcript, remainingQuestions)
        } catch (error) {
          correction = error.message
        }
      }

      if (remainingQuestions === 0) return { type: "exhausted" }

      throw new Error(`Akinator returned an invalid move. ${correction}`)
    },
  }
}
