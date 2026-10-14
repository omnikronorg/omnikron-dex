import { findSupportedChain } from "@/lib/chains";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useConnection } from "wagmi";

interface PoolsFormProps
{
    chainId: number;
    changeChainId(value: number): void;
}


function PoolsForm({chainId, changeChainId}: PoolsFormProps)
{
    const { address: walletAddress, isConnected } = useConnection();
    const chain = findSupportedChain(chainId);

    return (
        <div className="swap-card w-full max-w-[480px] p-4 rounded-3xl border shadow-xl">
            <div className="flex justify-between items-center mb-3 px-1">
                <div className="flex gap-4 font-medium">
                    <Link 
                        href="/swap"
                        className="swap-header-button pb-1"
                    >Swap</Link>
                    <button className="swap-header-button-selected border-b-2 pb-1">Liquidity Pools</button>
                </div>

            </div>
            <div className="flex gap-3">
                <button 
                    onClick={() => {}}
                    className="swap-action-button px-3 py-1.5 mt-3 transition-colors rounded-xl font-semibold flex items-center justify-center gap-2"
                >
                    Create Pool
                </button>

                <button 
                    onClick={() => {}}
                    className="swap-action-button px-3 py-1.5 mt-3 transition-colors rounded-xl font-semibold flex items-center justify-center gap-2"
                >
                    Add Liquidity
                    <PlusIcon />
                </button>
            </div>
        </div>
    )
}

export default PoolsForm