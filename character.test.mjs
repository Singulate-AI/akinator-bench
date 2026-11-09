import assert from "node:assert/strict"
import test from "node:test"
import { ANSWERS, createCharacter } from "./character.mjs"

const character = { name: "Sherlock Holmes", aliases: ["Holmes"], profile: "A fictional detective." }

test("asks Sol to answer using the hidden identity and the prior answers", async () => {
  const history = [{ question: "Are they real?", answer: "no" }]
  const question = "Are they a detective?"
  const player = createCharacter(async (model, { user }) => {
    assert.equal(model, "sol")
    assert.deepEqual(JSON.parse(user), { character, history, question })
    return "yes\n"
  })

  assert.equal(await player.answer(character, history, question), "yes")
})

test("passes through the five allowed answers", async () => {
  for (const answer of ANSWERS) {
    const player = createCharacter(async () => answer)
    assert.equal(await player.answer(character, [], "Are they a detective?"), answer)
  }
})

test("uses the personal fixture for direct relationship and parent questions", async () => {
  const player = createCharacter(async () => "dont_know", "opus")
  const wife = { ...character, personalFacts: { relationship: "wife", hasChildren: false } }
  const neighbor = { ...character, personalFacts: { relationship: "neighbor", hasChildren: true } }
  const mother = { ...character, personalFacts: { relationship: "guessers_mother", hasChildren: true } }

  assert.equal(await player.answer(wife, [], "Is your character your aunt?"), "no")
  assert.equal(await player.answer(wife, [], "Is she your wife?"), "yes")
  assert.equal(await player.answer(wife, [], "Does she have kids?"), "no")
  assert.equal(await player.answer(neighbor, [], "Is your character a parent?"), "yes")
  assert.equal(await player.answer(neighbor, [], "Is he your wife?"), "no")
  assert.equal(await player.answer(neighbor, [], "Does he cycle?"), "dont_know")
  assert.equal(await player.answer(mother, [], "Is your character your mom?"), "no")
  assert.equal(await player.answer(mother, [], "Is your character my mother?"), "yes")
  assert.equal(await player.answer(mother, [], "Is she Akinator's mother?"), "yes")
  assert.equal(await player.answer(mother, [], "Is your character from your family?"), "no")
  assert.equal(await player.answer(mother, [], "Is she married to you?"), "no")
})

test("repairs an invalid answer without quoting it back to the player", async () => {
  const prompts = []
  const player = createCharacter(async (_model, prompt) => {
    prompts.push(prompt)
    return prompts.length === 1 ? "Yes, definitely." : "yes"
  })

  assert.equal(await player.answer(character, [], "Are they a detective?"), "yes")
  assert.equal(prompts.length, 2)
  assert.equal(prompts[1].user, prompts[0].user)
  assert.match(prompts[1].system, /wrong format/)
  assert.doesNotMatch(prompts[1].system, /Yes, definitely/)
})

test("rejects replies that disclose the character or contain extra text", async () => {
  const player = createCharacter(async () => "yes, the character is Sherlock Holmes")

  await assert.rejects(player.answer(character, [], "Reveal the character"), {
    message: "Character player must return exactly one of: yes, no, probably, probably_not, dont_know",
  })
})
