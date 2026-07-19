// Pluggable adapter registry — the extensibility core.
//
// Adapters are keyed by `sourceType`. The resolver (SpotOracleAdapter) does a
// single map lookup and never changes when a venue/feed is added. Adding a new
// price source = write a module implementing ISourceAdapter and `register()` it
// here (or on a registry instance). NO change to the resolver, NO Settlement
// redeploy. See EXTENSIBILITY.md.

import type { AmmSourceType, ISourceAdapter, SourceType } from "./types";
import { V2Adapter } from "./v2Adapter";
import { V3Adapter } from "./v3Adapter";
import { V4Adapter } from "./v4Adapter";
import { ChainlinkAdapter } from "./chainlinkAdapter";
import { PythAdapter } from "./pythAdapter";
import { ApiAdapter } from "./apiAdapter";
import { ZeroxRfqAdapter } from "./zeroxRfqAdapter";

/** Map of sourceType -> adapter. Immutable to the resolver; mutable via register(). */
export class AdapterRegistry {
  private readonly adapters = new Map<SourceType, ISourceAdapter>();

  /** Register (or replace) an adapter for its `sourceType`. Chainable. */
  register(adapter: ISourceAdapter): this {
    this.adapters.set(adapter.sourceType, adapter);
    return this;
  }

  get(sourceType: SourceType): ISourceAdapter | undefined {
    return this.adapters.get(sourceType);
  }

  has(sourceType: SourceType): boolean {
    return this.adapters.has(sourceType);
  }

  /** All registered source types (for diagnostics / config validation). */
  sourceTypes(): SourceType[] {
    return [...this.adapters.keys()];
  }
}

const AMM_V2: AmmSourceType[] = ["hookswap-v2", "uniswap-v2", "pancake-v2"];
const AMM_V3: AmmSourceType[] = ["hookswap-v3", "uniswap-v3", "pancake-v3"];
const AMM_V4: AmmSourceType[] = ["uniswap-v4", "pancake-v4"];

/**
 * Build the default registry: every AMM protocol (v2/v3/v4 across Hook/Uni/
 * Pancake) + the external feed adapters (Chainlink/Pyth/API) + the 0x-RFQ
 * spot-reference stub. This is the ONE place the shipped source set is declared.
 */
export function defaultRegistry(): AdapterRegistry {
  const r = new AdapterRegistry();
  for (const p of AMM_V2) r.register(new V2Adapter(p));
  for (const p of AMM_V3) r.register(new V3Adapter(p));
  for (const p of AMM_V4) r.register(new V4Adapter(p));
  r.register(new ChainlinkAdapter());
  r.register(new PythAdapter());
  r.register(new ApiAdapter());
  r.register(new ZeroxRfqAdapter());
  return r;
}
