// Client-safe: AMM config cache + synchronous getter. Filled on the server
// (dataLoaders.server.ts) and hydrated on the client via Providers.

export interface ChainConfig
{
    chainId: number;
    wrappedNative: string;
    platformToken: string;
    factory: string;
    router: string;
}

// Memory cache of AMM config per chain, loading once at boot
// (instrumentation.ts) — same pattern of the token/network caches.
let chainConfigList: ChainConfig[] | null = null;

// Replaces the cached config list. Called by the server loader and by the
// client Providers during hydration.
export function setChainConfigList(list: ChainConfig[]): void
{
    chainConfigList = list;
}

// Full (unfiltered) config list across all chains. Used by the server layout
// to build the hydration payload for Providers.
export function getChainConfigList(): ChainConfig[]
{
    return chainConfigList ?? [];
}

export function getChainConfig(chainId: number | undefined): ChainConfig | null
{
    if(!chainId)
    {
        return null;
    }

    return (chainConfigList ?? []).find((config) => config.chainId === chainId) ?? null;
}
