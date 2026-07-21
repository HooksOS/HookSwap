import type { StreamEvent } from './types';

/**
 * Parse a fetch Response whose body is an SSE / newline-delimited-JSON stream
 * into an async iterator of typed StreamEvents.
 *
 * The backend RAG chat endpoint emits `data: {json}\n\n` frames (SSE). Each
 * frame's JSON payload is a `StreamEvent`. A terminal `data: [DONE]` is
 * tolerated. This helper is transport-agnostic — the same event schema is used
 * over WebSocket (see api.streamChatWs).
 */
export async function* parseSSE(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new Error('Response has no body to stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const evt = parseFrame(frame);
        if (evt) yield evt;
      }
    }
    // flush trailing frame
    const evt = parseFrame(buffer);
    if (evt) yield evt;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): StreamEvent | null {
  const dataLines = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) return null;
  const payload = dataLines.join('\n');
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload) as StreamEvent;
  } catch {
    return null;
  }
}

/**
 * A local mock stream generator used when the backend is not yet reachable, so
 * the chat UI is fully exercisable in isolation. Clearly-example content.
 */
export async function* mockStream(prompt: string): AsyncGenerator<StreamEvent> {
  const messageId = `msg_${Date.now()}`;
  yield { type: 'start', messageId, model: 'example/rag-router' };
  await sleep(120);

  yield {
    type: 'tool_call',
    tool: {
      id: 'tc1',
      name: 'chain_indexer.get_pool_tvl',
      args: { chain: 4663, pair: 'WETH/USDG' },
      status: 'running',
    },
  };
  await sleep(280);
  yield { type: 'tool_result', toolCallId: 'tc1', result: { tvlUsd: 1877650 }, status: 'done' };

  const answer =
    `Based on retrieved HookSwap sources, here's an example answer to "${prompt}". ` +
    `On **Robinhood Chain (4663)** the Universal Router is deployed at a non-canonical ` +
    `"min-hop-price" fork [1], and quotes flow through the self-hosted trading adapter in ` +
    `\`embed\` mode [2]. HookSwap ships **v2 + v3 only** (no v4/hooks) [3]. ` +
    `_Numbers shown are illustrative placeholder until the backend is wired._`;

  for (const chunk of chunkText(answer)) {
    yield { type: 'token', delta: chunk };
    await sleep(24);
  }

  const cites = [
    {
      id: 'c1', index: 1, title: 'Robinhood UR — min-hop-price fork', source: 'HookSwap Docs',
      snippet: 'The deployed Robinhood Universal Router decodes 6 fields (canonical 5 + trailing uint256[] minHopPriceX36).',
      url: 'https://docs.hookswap.org/chains/robinhood', score: 0.94, chain: 4663, protocol: 'Universal Router', type: 'documentation',
    },
    {
      id: 'c2', index: 2, title: 'Trading adapter — embed routing', source: 'Architecture',
      snippet: 'EmbedRoutingProvider.quoteExactRoute runs AlphaRouter + static v2/v3 subgraph providers in-process.',
      url: 'https://docs.hookswap.org/infra/adapter', score: 0.88, protocol: 'Universal Router', type: 'documentation',
    },
    {
      id: 'c3', index: 3, title: 'Locked decision — v4 excluded', source: 'CLAUDE.md',
      snippet: 'v4: EXCLUDE. Ship v2 + v3 only, supportsV4:false. No hooks for now.',
      score: 0.82, type: 'governance',
    },
  ];
  for (const c of cites) {
    yield { type: 'citation', citation: c };
    await sleep(40);
  }
  yield { type: 'confidence', score: 0.86 };
  yield { type: 'usage', tokens: { prompt: 412, completion: 188 }, latencyMs: 1430 };
  yield { type: 'done', messageId };
}

function chunkText(text: string): string[] {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 2) out.push(words.slice(i, i + 2).join(''));
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
