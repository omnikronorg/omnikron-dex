import { MongoHelper } from '@/lib/mongoHelper';
import { Token as TokenModel } from '@/models/token';
import { Amm } from '@/models/amm';

const tokenCollectionName = 'token';
const ammCollectionName = 'amm';

// Network native-coin metadata (what the USER sees). The token is stored against
// the chain's wrappedNative address but flagged isNative, so the UI shows ETH/BNB/POL.
interface NativeMeta
{
    symbol: string;
    name: string;
    logoURI: string;
}

const nativeMetadata: Record<number, NativeMeta> = {
    1:     { symbol: 'ETH',  name: 'Ether',         logoURI: '/tokens/eth.svg' },
    56:    { symbol: 'BNB',  name: 'BNB',           logoURI: '/tokens/bnb.svg' },
    97:    { symbol: 'tBNB', name: 'BNB (Testnet)', logoURI: '/tokens/bnb.svg' },
    137:   { symbol: 'POL',  name: 'Polygon',       logoURI: '/tokens/pol.svg' },
    31337: { symbol: 'ETH',  name: 'Ether',         logoURI: '/tokens/eth.svg' },
};

// Platform token metadata (from contracts/src/tokens/OmnikronToken.sol).
const platformTokenMeta = { symbol: 'OMNIKRON', name: 'Omnikron Token', decimals: 18, logoURI: '/tokens/omnikron.svg' };

// Curated well-known stablecoins/majors per chain. VERIFY these addresses before use.
// Testnet (97) and local Anvil (31337) are intentionally omitted to avoid inventing addresses.
interface SeedToken
{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string;
}

const curatedTokens: Record<number, SeedToken[]> = {
    1: [
        { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD',     decimals: 6,  logoURI: '/tokens/usdt.svg' },
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin',       decimals: 6,  logoURI: '/tokens/usdc.svg' },
        { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI',  name: 'Dai Stablecoin', decimals: 18, logoURI: '/tokens/dai.svg' },
    ],
    56: [
        { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD',  decimals: 18, logoURI: '/tokens/usdt.svg' },
        { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin',    decimals: 18, logoURI: '/tokens/usdc.svg' },
        { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD', name: 'Binance USD', decimals: 18, logoURI: '/tokens/busd.svg' },
    ],
    137: [
        { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD',     decimals: 6,  logoURI: '/tokens/usdt.svg' },
        { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', name: 'USD Coin',       decimals: 6,  logoURI: '/tokens/usdc.svg' },
        { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI',  name: 'Dai Stablecoin', decimals: 18, logoURI: '/tokens/dai.svg' },
    ],
};

// Seeds the "token" collection the first time it is empty, deriving native and
// platform tokens from the already-synced "amm" collection plus a curated list.
// Idempotent: never runs once the collection has any document.
export async function seedTokensIfEmpty(): Promise<void>
{
    const tokenCollection = new MongoHelper<TokenModel>(tokenCollectionName);
    const ammCollection = new MongoHelper<Amm>(ammCollectionName);

    // Only seed a brand-new (empty) collection; never overwrite existing data.
    const alreadySeeded = await tokenCollection.findOne({});
    if (alreadySeeded)
    {
        return;
    }

    const amms = await ammCollection.findMany({});
    const docs: TokenModel[] = [];

    for (const amm of amms)
    {
        const native = nativeMetadata[amm.chainId];

        // Native coin with the network symbol (ETH/BNB/POL) stored against the
        // chain's wrappedNative address and flagged isNative.
        if (native)
        {
            docs.push({
                chainId: amm.chainId,
                address: amm.wrappedNative,
                symbol: native.symbol,
                name: native.name,
                decimals: 18,
                logoURI: native.logoURI,
                isNative: true,
            });
        }

        // Platform token (Omnikron Token) deployed per chain.
        if (amm.platformToken)
        {
            docs.push({
                chainId: amm.chainId,
                address: amm.platformToken,
                symbol: platformTokenMeta.symbol,
                name: platformTokenMeta.name,
                decimals: platformTokenMeta.decimals,
                logoURI: platformTokenMeta.logoURI,
            });
        }

        // Curated stablecoins / majors for this chain.
        for (const token of curatedTokens[amm.chainId] ?? [])
        {
            docs.push({ chainId: amm.chainId, ...token });
        }
    }

    if (docs.length === 0)
    {
        return;
    }

    const result = await tokenCollection.insertMany(docs);
    console.log(`[seedTokensIfEmpty] Inserted ${result.insertedCount} token(s) across ${amms.length} chain(s)`);
}
