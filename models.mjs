import { setTimeout as sleep } from 'node:timers/promises';

const MODELS = {
  deepseek: {
    label: 'DeepSeek V4.1 Flash', protocol: 'chat', deployment: 'DeepSeek-V4.1-Flash',
  },
  luna: {
    label: 'GPT-6 Luna (medium)', protocol: 'responses', deployment: 'gpt-6-luna', effort: 'medium',
  },
  sol: {
    label: 'GPT-6.1 Sol (high)', protocol: 'responses', deployment: 'gpt-6.1-sol-standard-test', effort: 'high',
  },
  haiku: {
    label: 'Claude Haiku 5.5 (low)', protocol: 'messages', deployment: 'claude-haiku-5-5', effort: 'low',
  },
  opus: {
    label: 'Claude Opus 5.5 (high)', protocol: 'messages', deployment: 'claude-opus-5-5', effort: 'high',
  },
  argon: {
    label: 'Gemini 4 Argon', protocol: 'openrouter', deployment: 'google/gemini-4-argon',
  },
  gemini_flash: {
    label: 'Gemini 3.8 Flash', protocol: 'openrouter', deployment: 'google/gemini-3.8-flash',
  },
  gemini_lite: {
    label: 'Gemini 3.5 Flash-Lite', protocol: 'openrouter', deployment: 'google/gemini-3.5-flash-lite',
  },
  gemini_25_flash: {
    label: 'Gemini 2.5 Flash', protocol: 'openrouter', deployment: 'google/gemini-2.5-flash',
  },
  gemini_25_pro: {
    label: 'Gemini 2.5 Pro', protocol: 'openrouter', deployment: 'google/gemini-2.5-pro',
  },
  gpt5: {
    label: 'GPT-5', protocol: 'openrouter', deployment: 'openai/gpt-5', jsonMode: false,
  },
  opus_45: {
    label: 'Claude Opus 4.5', protocol: 'openrouter', deployment: 'anthropic/claude-opus-4.5',
  },
};

export const models = Object.entries(MODELS).map(([id, { label }]) => ({ id, label }));

export function configuredModels(env) {
  const azure = env.AZURE__OPENAI_BASE?.trim() && env.AZURE__API_KEY?.trim();
  const enabled = {
    chat: azure,
    responses: azure,
    messages: env.ANTHROPIC_API_KEY?.trim(),
    openrouter: env.OPENROUTER_API_KEY?.trim(),
  };
  return models.filter(({ id }) => enabled[MODELS[id].protocol]);
}

export function modelSettings(env, id) {
  if (!Object.hasOwn(MODELS, id)) throw new Error('Unknown benchmark model.');
  const { deployment, effort, protocol } = MODELS[id];
  return {
    deployment: env[`AKINATOR_${id.toUpperCase()}_MODEL`]?.trim() || deployment,
    effort: effort ?? null,
    protocol,
  };
}

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}. Load the benchmark credentials with Node's --env-file option.`);
  return value;
}

function azureBase(env) {
  const url = URL.parse(required(env, 'AZURE__OPENAI_BASE'));
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('AZURE__OPENAI_BASE must be an HTTPS Azure OpenAI v1 base URL.');
  }
  return url.href.replace(/\/$/, '');
}

function requestFor(env, id, { system, user }) {
  const { deployment: model, effort, protocol } = modelSettings(env, id);
  const input = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const maxTokens = 8192;

  if (protocol === 'openrouter') {
    const format = MODELS[id].jsonMode === false
      ? {}
      : { response_format: { type: 'json_object' }, tool_choice: 'none' };
    return {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: { authorization: `Bearer ${required(env, 'OPENROUTER_API_KEY')}` },
      body: { model, messages: input, max_tokens: maxTokens, ...format },
      extract: (data) => data.choices?.[0]?.message?.content,
    };
  }

  if (protocol === 'messages') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': required(env, 'ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      body: {
        model, system, messages: input.slice(1), max_tokens: maxTokens,
        thinking: { type: 'adaptive' }, output_config: { effort },
      },
      extract: (data) => data.content?.filter(({ type }) => type === 'text').map(({ text }) => text).join(''),
    };
  }

  const base = azureBase(env);
  const headers = { 'api-key': required(env, 'AZURE__API_KEY') };

  if (protocol === 'responses') {
    return {
      url: `${base}/responses`,
      headers,
      body: { model, input, reasoning: { effort }, max_output_tokens: maxTokens, store: false },
      extract: (data) => data.output
        ?.filter(({ type }) => type === 'message')
        .flatMap(({ content }) => content ?? [])
        .filter(({ type }) => type === 'output_text')
        .map(({ text }) => text)
        .join(''),
    };
  }

  return {
    url: `${base}/chat/completions`,
    headers,
    body: { model, messages: input, max_completion_tokens: maxTokens },
    extract: (data) => data.choices?.[0]?.message?.content,
  };
}

export function createCompleter(env, fetchRequest = fetch) {
  return async (id, prompts) => {
    const { url, headers, body, extract } = requestFor(env, id, prompts);

    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetchRequest(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
          redirect: 'error',
        });
      } catch (error) {
        const detail = error.name === 'TimeoutError' ? 'timed out' : 'could not connect';
        throw new Error(`${MODELS[id].label} ${detail}.`);
      }

      if (response.ok) {
        const data = await response.json().catch(() => null);
        const reply = data && extract(data);
        if (typeof reply === 'string' && reply.trim()) return reply;
        if (MODELS[id].protocol === 'openrouter' && attempt === 0) continue;
        throw new Error(`${MODELS[id].label} returned no usable answer text.`);
      }

      await response.body?.cancel();
      const retryable = [429, 500, 502, 503, 504, 529].includes(response.status);
      if (!retryable || attempt === 2) {
        throw new Error(`${MODELS[id].label} returned HTTP ${response.status}.`);
      }

      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Math.min(15_000, Math.max(1000 * (attempt + 1), retryAfter * 1000 || 0)));
    }
  };
}
