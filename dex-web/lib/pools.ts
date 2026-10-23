import { Address, getAddress } from "viem";
import { findSupportedChain } from "./chains";
import { getChainConfig } from "@/config/chainConfig";
import { callContractRead } from "./evm";
import { factoryAbi } from "./abi/factory";
import { pairAbi } from "./abi/pair";
import { findToken, getFirstNonNativeToken, getNativeToken, type Token } from "./tokens";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface UserPool
{
    chainId: number;
    pair: Address;
    token0: Token;
    token1: Token;
    reserve0: bigint;
    reserve1: bigint;
    userLiquidity: bigint;
}

// My Positions: lista as pools em que a wallet conectada possui LP balance > 0
export async function getUserPools(chainId: number, walletAddress: Address): Promise<UserPool[]>
{
    const chain = findSupportedChain(chainId);

    if(!chain)
    {
        return [];
    }

    const ammCfg = getChainConfig(chainId);

    if(!ammCfg)
    {
        return [];
    }

    const factory = getAddress(ammCfg.factory);
    const allPairsLength = await callContractRead(chainId, factory, factoryAbi, "allPairsLength", []) as bigint;

    const pools: UserPool[] = [];
    const totalPairs = Number(allPairsLength);

    for(let ix = 0; ix < totalPairs; ix++)
    {
        const pair = await callContractRead(chainId, factory, factoryAbi, "allPairs", [ BigInt(ix) ]) as Address;

        if(!pair || pair === ZERO_ADDRESS)
        {
            continue;
        }

        const userLiquidity = await callContractRead(chainId, pair, pairAbi, "balanceOf", [ walletAddress ]) as bigint;

        // My Positions: apenas pools com LP balance > 0 na carteira conectada
        if(userLiquidity <= 0n)
        {
            continue;
        }

        const reserves = await callContractRead(chainId, pair, pairAbi, "getReserves", []) as readonly [bigint, bigint, number];
        const token0Address = await callContractRead(chainId, pair, pairAbi, "token0", []) as Address;
        const token1Address = await callContractRead(chainId, pair, pairAbi, "token1", []) as Address;

        const token0 = findToken(chainId, token0Address) ?? getNativeToken(chainId);
        const token1 = findToken(chainId, token1Address) ?? getFirstNonNativeToken(chainId);

        pools.push({
            chainId,
            pair,
            token0,
            token1,
            reserve0: reserves[0],
            reserve1: reserves[1],
            userLiquidity,
        });
    }

    return pools;
}