import type { Token as TokenModel } from "@/models/token";

// Client-safe token cache + synchronous getters. The cache is filled on the
// server (dataLoaders.server.ts) and hydrated on the client via Providers.
// Do NOT import MongoHelper/mongodb here.

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

// In-memory cache of the full token list (all chains).
let tokenList: TokenModel[] | null = null;

// Replaces the cached token list. Called by the server loader and by the
// client Providers during hydration.
export function setTokenList(list: TokenModel[]): void
{
    tokenList = list;
}

// Full (unfiltered) token list across all chains. Used by the server layout to
// build the hydration payload for Providers.
export function getTokenListAll(): TokenModel[]
{
    return tokenList ?? [];
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
