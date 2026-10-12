import type { Chain } from "viem";
import { http } from "viem";
import { anvil as viemAnvil, bsc as viemBsc, bscTestnet as viemBscTestnet, mainnet as viemMainnet, polygon as viemPolygon } from "viem/chains";

// Aplica o RPC do .env.local na chain do viem; preserva os outros dados do RPC default (ex: webSocket)
function withRpc<chain extends Chain>(chain: chain, rpcUrl: string | undefined): chain
{
    if(!rpcUrl)
    {
        return chain;
    }

    return {
        ...chain,
        rpcUrls: {
            ...chain.rpcUrls,
            default: {
                ...chain.rpcUrls.default,
                http: [ rpcUrl ],
            },
        },
    };
}

// Ethereum (1)
export const ethereum = withRpc(viemMainnet, process.env.NEXT_PUBLIC_MAINNET_RPC_URL);

// BNB Smart Chain (56)
export const bnb = withRpc(viemBsc, process.env.NEXT_PUBLIC_BSC_RPC_URL);

// BNB Smart Chain Testnet (97) - rede de homologacao (deploy atual)
export const bscTestnet = withRpc(viemBscTestnet, process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL);

// Polygon (137)
export const polygon = withRpc(viemPolygon, process.env.NEXT_PUBLIC_POLYGON_RPC_URL);

// Anvil (31337) - rede local de desenvolvimento
export const anvilLocal = withRpc(viemAnvil, process.env.NEXT_PUBLIC_ANVIL_RPC_URL);

// Array usado no createConfig do wagmi; a primeira chain e a default do config do wagmi
export const supportedChains = [bscTestnet, anvilLocal, ethereum, bnb, polygon] as const;

// Transports HTTP por chain (http() sem URL usa rpcUrls.default.http[0] da propria chain)
export const supportedTransports = {
    [bscTestnet.id]: http(),
    [anvilLocal.id]: http(),
    [ethereum.id]: http(),
    [bnb.id]: http(),
    [polygon.id]: http(),
};

// Ids de chain configuradas no wagmi
export type SupportedChainId = typeof supportedChains[number]["id"];

// Estreita um chainId vindo da UI (number) para uma chain configurada
export function findSupportedChain(chainId: number | undefined)
{
    return supportedChains.find((chain) => chain.id === chainId);
}
