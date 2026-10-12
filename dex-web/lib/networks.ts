import { Amm } from "@/models/amm";
import { MongoHelper } from "./mongoHelper";
import { supportedChains } from "./chains";

export interface Network
{
    id: number;
    name: string;
    symbol: string;
    logoURI: string;
    wrappedNative: string;
}

const ammCollectionName = 'amm';

// In-memory cache of the network list, loaded once at boot (instrumentation.ts).
let networkList: Network[] | null = null;

// Loads network metadata into the in-memory cache. Must run after
// syncAmmFromDeployments() so chainName/chainLogoURI/wrappedNative exist.
export async function loadNetworkList(): Promise<void>
{
    if(networkList !== null)
    {
        return;
    }

    const amm = new MongoHelper<Amm>(ammCollectionName);
    const rows = await amm.findMany({});

    networkList = supportedChains.map((chain) => {
        const row = rows.find((r) => r.chainId === chain.id);
        return {
            id: chain.id,
            name: row?.chainName || chain.name,                 // chainName do banco
            symbol: chain.nativeCurrency.symbol,                // símbolo do viem (fonte única)
            logoURI: row?.chainLogoURI || '/network/generic.svg',
            wrappedNative: row?.wrappedNative || '',
        };
    });
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