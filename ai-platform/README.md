# HookSwap AI Knowledge Platform

> **⛔ INTERNAL USE ONLY (from Reggie, 2026-07-19).** This is a HookSwap **team tool**, not a
> public product. Internal auth only — no public signup, no customer billing, no marketing
> funnel. The multi-tenant layer (orgs/projects/teams/RBAC) is for **internal team/project
> separation**; "billing" = **internal usage/cost tracking** only. Deploy **behind auth on
> internal infra**, not public-scale. Real security still required (auth, secrets, audit,
> PII, prompt-injection / RAG-poisoning defenses) — internal-tools posture, not SOC2-for-customers.

Enterprise-grade, multi-tenant (**internal**) **RAG / AI Knowledge Layer** that powers every feature of the
HookSwap multi-chain DEX — semantic search, AI chat, trading/dev/support/governance
assistants, liquidity & risk analytics, launchpad support, marketing generation, and
autonomous AI agents. Built to be production-grade and horizontally scalable.

> **Status: scaffolding.** This directory is being stood up as a coherent monorepo of
> services. Each subsystem is built by an owning module (see structure). Do NOT ship
> fabricated data — every stat/address/number the AI states must come from a retrieved
> source or a live tool call (HookSwap facts-only rule).

---

## Chain registry — HookSwap LIVE chains only (architecture supports unlimited more)

Per Reggie: **we use the chains HookSwap is actually live on**, not a generic list. The
chain layer is a registry + adapter pattern, so new chains (Base, BNB, Arbitrum, … when
HookSwap expands) are added by config alone.

| Chain | chainId | Native | Notes |
|---|---|---|---|
| Robinhood | 4663 | ETH | primary live chain |
| HyperEVM | 999 | HYPE | |
| Ink | 57073 | ETH | |
| MegaETH | 4326 | ETH | |
| XLayer | 196 | OKB | gas in OKB |
| Tempo | 4217 | pathUSD | gas in pathUSD |
| Sepolia | 11155111 | ETH | **mandatory validation chain (deploy+test here first)** |

Canonical config: `packages/chains/chains.ts` (mirrors the DEX's `contracts/deployments/*.json`).

---

## Tech stack (locked)

- **Frontend:** Next.js 15 (App Router) · React · TypeScript · TailwindCSS · shadcn/ui · Framer Motion
- **Backend:** FastAPI (Python, fully async) · Pydantic v2
- **Datastores:** PostgreSQL (+ pgvector fallback) · Redis · **Qdrant** (vector) behind a `VectorStore` abstraction (Pinecone/Milvus/Weaviate adapters) · **OpenSearch** (BM25/hybrid) · **S3** (object/raw storage)
- **Embeddings:** provider abstraction — OpenAI · Voyage · BGE · Nomic
- **LLMs:** provider abstraction — OpenAI · Anthropic · Gemini · OpenRouter · Ollama
- **Queues/workers:** BullMQ + Redis (ingestion/index/agent jobs)
- **Infra:** Docker · Kubernetes · Terraform · GitHub Actions

---

## Monorepo structure

```
ai-platform/
├── docs/                 # 21 architecture deliverables (arch, ER, schema, lifecycles, security, deploy, roadmap)
├── backend/              # FastAPI: RAG engine, retrieval, API (REST/GraphQL/WS), multi-tenant/RBAC, LLM+embed abstraction
│   └── app/{api,core,rag,retrieval,agents,tenancy,security,models,services,workers}
├── ingestion/            # source connectors + ingestion pipeline (extract→normalize→chunk→embed→version→dedup→upsert) + blockchain indexer
│   └── {connectors,pipeline,chain_indexer,workers}
├── knowledge-graph/      # KG schema + graph traversal (chains↔protocols↔tokens↔pools↔wallets↔governance↔contracts)
├── agents/               # AI agent framework + the assistant fleet (trading, liquidity, dev, support, docs, security, governance, marketing, research, analytics, portfolio, custom)
├── frontend/             # Next.js 15 user + admin dashboards (AI chat, search, trading assistant, portfolio, admin/analytics/billing)
├── packages/             # shared: chains registry, types, sdk (py/ts/js), schemas
├── infra/                # Docker, docker-compose, k8s manifests, Terraform, CI/CD
└── README.md
```

## Core principles

1. **Grounded, never fabricated** — retrieval + live tools; citations + confidence + hallucination detection on every answer.
2. **Static vs dynamic knowledge** — docs/whitepapers/ABIs are embedded; TVL/volume/pool/wallet stats are pulled LIVE at query time (chain indexer + DEX data-api tools), so numbers are always current + real.
3. **Multi-tenant from day one** — Organizations → Projects → Teams → RBAC → API keys → usage/billing.
4. **Chain-, wallet-, and time-aware retrieval** — metadata filters (chain/protocol/pool/token/contract/version/date/risk) on every query.
5. **Sepolia-first** — any contract the platform deploys is proven on Sepolia before production chains.

## Build phases

- **P1 (foundation):** chain registry, ingestion pipeline (docs + chain data), Qdrant + hybrid search, RAG engine (retrieve→build→generate→cite), core FastAPI API, docs Q&A + AI chat, user dashboard shell, Docker/compose, CI.
- **P2 (intelligence):** knowledge graph, the agent fleet (trading/dev/support/marketing first), live-data tools, admin dashboard + analytics, multi-tenant/billing, OpenSearch hybrid, streaming.
- **P3 (scale/enterprise):** k8s + Terraform, autoscaling workers, SOC2/GDPR controls, prompt-injection + RAG-poisoning defenses, SDKs, multi-channel bots, evaluation harness.
