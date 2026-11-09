# Akinator Bench

A local guessing game and a benchmark of 12 language models across 10 targets, with the official
Akinator game as a comparison. The bundled report contains 120 model games and 10 official trials.

## View the reference scoreboard

Use Node.js 22 or later. The app uses the Node standard library.

```sh
npm start
```

Open [http://127.0.0.1:4318](http://127.0.0.1:4318) and choose **Results**. The recorded scores are
available without API access. Expand **First guesses by character** to inspect individual outcomes.
Set `AKINATOR_PORT` to use another port.

| Model or baseline | Total questions |
| --- | ---: |
| GPT-6.1 Sol (high) | 216 |
| Gemini 4 Argon | 234 |
| GPT-5 | 252 |
| Claude Opus 5.5 (high) | 272 |
| Official Akinator | 279 |
| GPT-6 Luna (medium) | 329 |
| Gemini 3.8 Flash | 331 |
| Gemini 3.5 Flash-Lite | 390 |
| Gemini 2.5 Pro | 400 |
| Claude Opus 4.5 | 402 |
| Claude Haiku 5.5 (low) | 420 |
| Gemini 2.5 Flash | 469 |
| DeepSeek V4.1 Flash | 475 |

## Play or run a new benchmark

Copy [.env.example](.env.example) to `.env` and supply your own values for the providers you plan
to use. The Azure base is your deployment resource's HTTPS OpenAI v1 URL ending in `/openai/v1/`.
Available model IDs and default deployment names are in [models.mjs](models.mjs). Set
`AKINATOR_<MODEL_ID_IN_UPPERCASE>_MODEL` to override a deployment name for your account.

```sh
node --env-file=.env server.mjs
```

In **Play**, pick an enabled model and think of a character. Answer its questions and judge its
first guess. Interactive play uses the selected model's provider. Batch runs also require the
providers for the answerers described in the methodology.

```sh
node --env-file=.env bench.mjs --model haiku --character tom_cruise
AKINATOR_RESULTS_FILE=runs/results.json node --env-file=.env server.mjs
```

Omit `--model` and `--character` to use all configured models and all ten targets. Repeat either
flag for a subset. Use `--output` to keep runs in separate files. Add `--resume` with the same
selection, settings and output to keep completed games and retry interrupted ones. Use one runner
per output file. `--concurrency` defaults to 5 and accepts 1 through 10. Local environment files
and generated runs are gitignored.

Run the checks with `npm test`. See [Methodology](METHODOLOGY.md) for the protocol, scoring and
limits of the comparison.
