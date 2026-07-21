/**
 * HookSwap LIVE chain registry (mirrors ai-platform/README.md + the DEX
 * contracts/deployments/*.json). The AI platform filters retrieval by these
 * chains; new chains are added here by config alone.
 */
export interface ChainInfo {
  id: number;
  key: string;
  name: string;
  nativeCurrency: string;
  color: string;
  notes?: string;
  testnet?: boolean;
}

export const HOOKSWAP_CHAINS: ChainInfo[] = [
  { id: 4663, key: 'robinhood', name: 'Robinhood', nativeCurrency: 'ETH', color: '#00C805', notes: 'primary live chain' },
  { id: 999, key: 'hyperevm', name: 'HyperEVM', nativeCurrency: 'HYPE', color: '#97FCE4' },
  { id: 57073, key: 'ink', name: 'Ink', nativeCurrency: 'ETH', color: '#7A5CFA' },
  { id: 4326, key: 'megaeth', name: 'MegaETH', nativeCurrency: 'ETH', color: '#F5A623' },
  { id: 196, key: 'xlayer', name: 'XLayer', nativeCurrency: 'OKB', color: '#111111', notes: 'gas in OKB' },
  { id: 4217, key: 'tempo', name: 'Tempo', nativeCurrency: 'pathUSD', color: '#0EA5E9', notes: 'gas in pathUSD' },
  { id: 11155111, key: 'sepolia', name: 'Sepolia', nativeCurrency: 'ETH', color: '#CFB53B', notes: 'mandatory validation chain', testnet: true },
];

export const CHAIN_BY_ID: Record<number, ChainInfo> = Object.fromEntries(
  HOOKSWAP_CHAINS.map((c) => [c.id, c]),
);

export const CHAIN_BY_KEY: Record<string, ChainInfo> = Object.fromEntries(
  HOOKSWAP_CHAINS.map((c) => [c.key, c]),
);

export const PROTOCOLS = ['Uniswap v2', 'Uniswap v3', 'Universal Router', 'Permit2', 'HookSwap Launchpad'] as const;

export const KNOWLEDGE_TYPES = [
  'documentation',
  'whitepaper',
  'contract-abi',
  'audit',
  'governance',
  'pool-data',
  'token-metadata',
  'faq',
  'tutorial',
] as const;

export type ProtocolFilter = (typeof PROTOCOLS)[number];
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
