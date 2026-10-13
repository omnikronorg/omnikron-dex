// Client-safe: network cache + synchronous getters. The cache is filled on the
// server (dataLoaders.server.ts) and hydrated on the client via Providers.
// Do NOT import MongoHelper/mongodb here.

export interface Network
{
    id: number;
    name: string;
    symbol: string;
    logoURI: string;
    wrappedNative: string;
}

// In-memory cache of the network list. Populated on the server at boot
// (instrumentation.ts) and hydrated on the client (Providers).
let networkList: Network[] | null = null;

// Replaces the cached network list. Called by the server loader and by the
// client Providers during hydration.
export function setNetworkList(list: Network[]): void
{
    networkList = list;
}

export function getNetworkList(): Network[]
{
    return networkList ?? [];
}

export function findNetwork(chainId: number | undefined): Network
{
    const result = getNetworkList().find((network) => network.id === chainId);

    if(!result)
    {
        return { id: 0, name: 'Unknown', symbol: 'NONE', logoURI: '', wrappedNative: '' };
    }

    return result;
}
