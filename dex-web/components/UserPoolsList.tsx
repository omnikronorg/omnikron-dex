"use client";

import Image from "next/image";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useConnection } from "wagmi";
import { useEffect, useState } from "react";
import { formatEth } from "@/lib/utils";
import { getUserPools, type UserPool } from "@/lib/pools";
import { type Token } from "@/lib/tokens";

interface UserPoolsListProps
{
    chainId: number;
    OnAddLiquidity(tokenA: Token, tokenB: Token): void;
    OnRemoveLiquidity(pool: UserPool): void;
}

function UserPoolsList({chainId, OnAddLiquidity, OnRemoveLiquidity}: UserPoolsListProps)
{
    const { address: walletAddress, isConnected } = useConnection();

    const [pools, setPools] = useState<UserPool[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() =>
    {
        let isCancelled = false;

        async function loadUserPools()
        {
            if(!isConnected || !walletAddress)
            {
                setPools([]);
                return;
            }

            setIsLoading(true);
            setErrorMessage(null);

            try
            {
                const userPools = await getUserPools(chainId, walletAddress);

                if(!isCancelled)
                {
                    setPools(userPools);
                }
            }
            catch
            {
                if(!isCancelled)
                {
                    setErrorMessage("Failed to load your pools.");
                }
            }
            finally
            {
                if(!isCancelled)
                {
                    setIsLoading(false);
                }
            }
        }

        loadUserPools();

        return () => { isCancelled = true; };
    }, [chainId, walletAddress, isConnected]);

    if(!isConnected || !walletAddress)
    {
        return (
            <div className="pool-section p-3 rounded-2xl border">
                <div className="pool-section-label text-xs">Connect your wallet to view your positions.</div>
            </div>
        );
    }

    if(isLoading)
    {
        return (
            <div className="pool-section p-3 rounded-2xl border">
                <div className="pool-section-label text-xs">Loading your pools...</div>
            </div>
        );
    }

    if(errorMessage)
    {
        return (
            <div className="pool-section p-3 rounded-2xl border">
                <div className="pool-section-label text-xs">{errorMessage}</div>
            </div>
        );
    }

    if(pools.length == 0)
    {
        return (
            <div className="pool-section p-3 rounded-2xl border">
                <div className="pool-section-label text-xs">No pools found for your wallet.</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {pools.map((pool) =>
            {
                const token0 = pool.token0;
                const token1 = pool.token1;

                return (
                    <div key={pool.pair} className="pool-section p-3 rounded-2xl border">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Image src={token0.logoURI} alt={token0.symbol} width={28} height={28} className="swap-modal-row-icon rounded-full" />
                                <span className="swap-modal-row-name text-sm font-bold">{token0.symbol}</span>
                                <span className="pool-ratio-equals">/</span>
                                <Image src={token1.logoURI} alt={token1.symbol} width={28} height={28} className="swap-modal-row-icon rounded-full" />
                                <span className="swap-modal-row-name text-sm font-bold">{token1.symbol}</span>
                            </div>
                            <span className="pool-fee-badge text-xs px-2 py-1 rounded-full">0.30%</span>
                        </div>

                        <div className="swap-label text-xs block mt-2">Liquidity</div>
                        <div className="text-xs mt-1">
                            {token0.symbol}: {formatEth(pool.reserve0, token0.decimals)}
                        </div>
                        <div className="text-xs mt-1">
                            {token1.symbol}: {formatEth(pool.reserve1, token1.decimals)}
                        </div>

                        <div className="flex gap-3 mt-3">
                            <button
                                onClick={() => { OnAddLiquidity(token0, token1) }}
                                className="swap-action-alt-button px-3 py-2 mt-3 transition-colors rounded-xl font-semibold flex items-center justify-center gap-2"
                            >
                                <PlusIcon className="w-4 h-4" />
                                Add
                            </button>

                            <button
                                onClick={() => { OnRemoveLiquidity(pool) }}
                                className="swap-action-alt-button px-3 py-2 mt-3 transition-colors rounded-xl font-semibold flex items-center justify-center gap-2"
                            >
                                <MinusIcon className="w-4 h-4" />
                                Remove
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default UserPoolsList;
