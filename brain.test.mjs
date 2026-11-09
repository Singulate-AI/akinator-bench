import assert from "node:assert/strict"
import { test } from "node:test"
import { createBrain, MAX_QUESTIONS } from "./brain.mjs"

test("passes only the public question and answer transcript to the selected model", async () => {
  const brain = createBrain(async (model, { user }) => {
    assert.deepEqual({ model, ...JSON.parse(user) }, {
      model: "luna",
      transcript: [{ question: "Is your character real?", answer: "no" }],
      remainingQuestions: MAX_QUESTIONS - 1,
    })
    return '{"type":"question","text":"Does your character first appear in a book?"}'
  })

  await brain.next("luna", [{ question: "Is your character real?", answer: "no", hiddenCharacter: "Batman" }])
})

test("requests a new move when a question repeats with different casing and punctuation", async () => {
  const brain = createBrain(async (_model, { user }) => {
    if (JSON.parse(user).correction) return '{"type":"guess","text":"Jane Austen"}'
    return '{"type":"question","text":"IS YOUR CHARACTER ENGLISH?"}'
  })

  const move = await brain.next("haiku", [{ question: "Is your character English ?", answer: "yes" }])
  assert.deepEqual(move, { type: "guess", text: "Jane Austen" })
})

test("accepts one JSON move enclosed in a Markdown code fence", async () => {
  const brain = createBrain(async () => '```json\n{"type":"question","text":"Are they real?"}\n```')

  assert.deepEqual(await brain.next("gemini_lite", []), { type: "question", text: "Are they real?" })
})

test("requires a guess after the question budget is exhausted", async () => {
  const history = Array.from({ length: MAX_QUESTIONS }, (_, index) => ({
    question: `Is ${index} relevant to your character?`, answer: "no",
  }))
  const brain = createBrain(async (_model, { user }) => {
    if (JSON.parse(user).correction) return '{"type":"guess","text":"Hermione Granger"}'
    return '{"type":"question","text":"Is your character a wizard?"}'
  })

  assert.deepEqual(await brain.next("sol", history), { type: "guess", text: "Hermione Granger" })
})

test("accepts a relationship as the final guess", async () => {
  const brain = createBrain(async () => '{"type":"guess","text":"Your wife"}')

  const move = await brain.next("sol", [{ question: "Are you married to this person?", answer: "yes" }])
  assert.deepEqual(move, { type: "guess", text: "Your wife" })
})

test("ends the game when a model still asks a question after answer 35", async () => {
  const history = Array.from({ length: 35 }, (_, index) => ({
    question: `Is ${index} relevant to your character?`, answer: "no",
  }))
  const brain = createBrain(async () => '{"type":"question","text":"Is your character famous?"}')

  assert.deepEqual(await brain.next("sol", history), { type: "exhausted" })
})

test("fails clearly when the model still cannot supply a valid move after one correction", async () => {
  let attempts = 0
  const brain = createBrain(async () => {
    attempts += 1
    if (attempts > 2) throw new Error("Unexpected additional model call")
    return "What a mysterious character!"
  })

  await assert.rejects(brain.next("deepseek", []), /Akinator returned an invalid move.*single JSON object/)
})
