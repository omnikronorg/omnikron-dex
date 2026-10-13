// SERVER-ONLY data loaders. These query MongoDB and populate the client-safe
// in-memory caches (networks/tokens/chainConfig) via their setter functions.
// Imported ONLY by instrumentation.ts (Node.js runtime). Never import this
// from a Client Component — it pulls in the MongoDB driver (child_process).
import { MongoHelper } from '@/lib/mongoHelper';
import type { Amm } from '@/models/amm';
import type { Token as TokenModel } from '@/models/token';
import { supportedChains } from './chains';
import { setNetworkList, type Network } from './networks';
import { setTokenList } from './tokens';
import { setChainConfigList, type ChainConfig } from '@/config/chainConfig';

const ammCollectionName = 'amm';
const tokenCollectionName = 'token';

let ensurePromise: Promise<void> | null = null;

// Idempotent: queries MongoDB at most once per server instance. Safe to call
// from the layout on every request — after the first load the caches are warm.
export async function ensureDataLoaded(): Promise<void>
{
    if(ensurePromise)
    {
        return ensurePromise;
    }

    ensurePromise = (async () =>
    {
        await loadTokenList();
        await loadNetworkList();
        await loadChainConfigList();
    })();

    return ensurePromise;
}

// Loads network metadata into the in-memory cache. Must run after
// syncAmmFromDeployments() so chainName/chainLogoURI/wrappedNative exist.
export async function loadNetworkList(): Promise<void>
{
    const amm = new MongoHelper<Amm>(ammCollectionName);
    const rows = await amm.findMany({});

    const list: Network[] = supportedChains.map((chain) => {
        const row = rows.find((r) => r.chainId === chain.id);
        return {
            id: chain.id,
            name: row?.chainName || chain.name,
            symbol: chain.nativeCurrency.symbol,
            logoURI: row?.chainLogoURI || '/network/generic.svg',
            wrappedNative: row?.wrappedNative || '',
        };
    });

    setNetworkList(list);
}

// Loads the full token collection (all chains) into the in-memory cache.
// The ObjectId `_id` is dropped so the cached rows stay RSC-serializable when
// handed to the client for hydration.
export async function loadTokenList(): Promise<void>
{
    const tokenCollection = new MongoHelper<TokenModel>(tokenCollectionName);
    const rows = await tokenCollection.findMany({});

    const clean: TokenModel[] = rows.map((row) => ({
        chainId: row.chainId,
        address: row.address,
        symbol: row.symbol,
        name: row.name,
        decimals: row.decimals,
        logoURI: row.logoURI,
        isNative: row.isNative,
    }));

    setTokenList(clean);
}

// Loads the AMM config per chain into the in-memory cache.
export async function loadChainConfigList(): Promise<void>
{
    const amm = new MongoHelper<Amm>(ammCollectionName);
    const rows = await amm.findMany({});

    const list: ChainConfig[] = rows.map((row) => ({
        chainId: row.chainId,
        wrappedNative: row.wrappedNative,
        platformToken: row.platformToken,
        factory: row.factory,
        router: row.router,
    }));

    setChainConfigList(list);
}
