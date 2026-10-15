import { findSupportedChain } from "@/lib/chains";
import { DropletIcon, DropletsIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useConnection } from "wagmi";
import CreatePoolWindow from "./CreatePoolWindow";

interface PoolsFormProps
{
    chainId: number;
    changeChainId(value: number): void;
}

function PoolsForm({chainId, changeChainId}: PoolsFormProps)
{
    const { address: walletAddress, isConnected } = useConnection();
    const chain = findSupportedChain(chainId);

    const [createPoolWindowOpened, setCreatePoolWindowOpened] = useState(false);

    function OnCreatePoolWindowOpen()
    {
        setCreatePoolWindowOpened(true);
    }

    function OnCreatePoolWindowClose()
    {
        setCreatePoolWindowOpened(false);
    }

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
                    onClick={() => {
                        OnCreatePoolWindowOpen();
                    }}
                    className="swap-action-alt-button px-3 py-3 mt-3 transition-colors rounded-xl font-semibold flex items-center justify-center gap-2"
                >
                    <DropletsIcon />
                    Create Pool
                </button>

                <button 
                    onClick={() => {}}
                    className="swap-action-button px-3 py-3 mt-3 transition-colors rounded-xl font-semibold flex items-center justify-center gap-2"
                >
                    <PlusIcon />
                    Add Liquidity
                    
                </button>
            </div>

            {createPoolWindowOpened && (
                <CreatePoolWindow
                    chainId={chainId}
                    changeChainId={changeChainId}
                    onClose={OnCreatePoolWindowClose}
                />
            )}
        </div>
    )
}

export default PoolsForm