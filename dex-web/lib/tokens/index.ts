import { MongoHelper } from "../mongoHelper";
import { Token as TokenModel } from "@/models/token";

// Formato de um token exibido na interface.
export interface Token
{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string;
    isNative?: boolean;
}


// In-memory cache of the full token list (all chains). Loaded once at boot
// (see instrumentation.ts) and reused to avoid querying MongoDB on every call.
let tokenList: TokenModel[] | null = null;

// Guards concurrent lazy loads so the database is queried at most once.
let tokenListPromise: Promise<void> | null = null;

// Loads the full token collection (no filter) into the in-memory cache.
// Safe to call repeatedly: it queries the database only while the cache is
// still empty. Called once during server startup (instrumentation.ts).
export async function loadTokenList(): Promise<void>
{
    const tokenCollectionName = 'token';
    const tokenCollection = new MongoHelper<TokenModel>(tokenCollectionName);

    if(tokenList !== null)
    {
        return;
    }

    if(!tokenListPromise)
    {
        tokenListPromise = tokenCollection.findMany({}).then(
            (tokens) => {
                tokenList = tokens;
            },
            (error) => {
                // Allow a later call to retry after a transient failure.
                tokenListPromise = null;
                throw error;
            },
        );
    }

    await tokenListPromise;
}

// Retorna a lista de tokens suportados para a rede informada.
export function getTokenList(chainId: number | undefined): Token[]
{
    if (!chainId)
    {
        return [];
    }

    const resultList = (tokenList ?? []).filter((item) =>{
        return item.chainId == chainId
    });

    return resultList ?? [];
}

// Busca um token conhecido pela lista padrao, a partir do endereco.
export function findToken(chainId: number | undefined, address: string): Token | undefined
{
    const result = (tokenList ?? []).find((token) =>
        token.address.toLowerCase() === address.toLowerCase() && token.chainId === chainId);

    return result;
}

export function getNativeToken(chainId: number | undefined): Token
{
    const result = (tokenList ?? []).find((token) => token.isNative == true && token.chainId === chainId);

    if(!result)
    {
        return {
            "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "symbol": "ETH",
            "name": "Ether",
            "decimals": 18,
            "logoURI": "/tokens/eth.svg",
            "isNative": true
        }
    }

    return result;
}

export function getFirstNonNativeToken(chainId: number | undefined): Token
{
    const result = (tokenList ?? []).find((token) => token.isNative == false && token.chainId === chainId);

    if(!result)
    {
        return {
            "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            "symbol": "USDT",
            "name": "Tether USD",
            "decimals": 6,
            "logoURI": "/tokens/usdt.svg"
        }
    }

    return result;
}
