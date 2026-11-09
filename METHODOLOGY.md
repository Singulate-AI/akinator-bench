# Methodology

## Targets and roles

Each model played one scored game per target. The ten targets were My wife, My Neighbour (Ben),
Tom Cruise, Arnold Schwarzenegger, Pickle Rick, Oolong, Donald Trump, Dr. Evil, Your mother / Yo momma,
and Scarlett Johansson. The relationship labels use the player's point of view. "My wife" means the
player's wife, so "Your wife" is a correct guess from the guesser's point of view. "Your mother / Yo
momma" means the guesser's mother in the joke. The wife and neighbour use fictional backstories for
ordinary personal facts. The wife fixture is a fictional librarian for future runs.
[Character fixtures](data/characters.json)

The evaluated model sees a shared [guesser prompt](brain.mjs), the question-and-answer transcript,
and the remaining question budget. It returns one yes/no question or one final guess. A separate model
answers from the hidden identity, profile, and history using Yes, No, Probably, Probably not, or Don't
know. Direct questions about specified personal facts can use fixed answers. GPT-6.1 Sol high answered
for other guessers. Claude Opus 5.5 high answered when Sol was the guesser.

The [reference report](data/reference-results.json) records the model identifiers, routes, reasoning
settings, prompt, transcripts, question counts, first guesses, and scoring decisions. The run used
Azure for DeepSeek, Luna, and Sol, Anthropic for Haiku 5.5 and Opus 5.5, and OpenRouter for the Gemini
models, GPT-5, and Opus 4.5.

The reference wife rounds retain their historical outcomes and question counts. Their transcripts
and model guesses are withheld for privacy. The fictional librarian profile applies to new runs.

## Scoring

A game ends at the first named guess. The guesser can ask up to 35 questions and make its final guess
after answer 35. For a correct guess, charge the number of questions answered. For an incorrect guess
or a game that reaches the cap without a valid guess, charge 50 in total. Sum the charges across all
ten targets and rank from lowest to highest. A run with an unscored game is pending until it can be
scored.

The automatic matcher folds case, accents, punctuation, and whitespace when comparing against the
target and its aliases. A small number of first guesses were adjudicated for clear identity despite
extra wording or malformed output. The report records those decisions. Pickle Rick requires the
pickle incarnation. The neighbour guess "Your friend Ben" was scored as incorrect. An explicit
"Yo Mama" joke guess identifies the intended mother round.

Interrupted model games were retried. Some continuations reused the saved answers and are marked
in the report. GPT-5's Dr. Evil continuation used a longer response timeout.

## Official comparison and limits

The official English Akinator game was played manually with the same intended targets and profile
facts. The [baseline log](data/baselines.json) records the selected answers, paraphrased question topics,
first guesses, and counts used for scoring. It uses the same first-guess rule and 50-question miss
charge. The scored wife trial guessed "Your wife". The scored joke trial guessed "Rahul Rais Future Bae".
The earlier wrong-target trial and separately played personal games are outside this scorecard.

The official trials used a human proxy, while the model games used LLM answerers and fixed personal
facts. Ambiguous questions can lead to different answers across runs. For example, the official joke
trial made assumptions about some physical traits of the stock character. The small hand-picked
roster, one scored game per pairing, and differing provider settings make these results a snapshot
under this protocol. Fresh runs may produce different guesses.
