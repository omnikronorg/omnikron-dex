import { findSupportedChain } from "@/lib/chains";
import { DropletIcon, DropletsIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useConnection } from "wagmi";
import CreatePoolWindow from "./CreatePoolWindow";
import { Token } from "@/lib/tokens";
import NotificationCard, { NotificationCardProps } from "./NotificationCard";
import UserPoolsList from "./UserPoolsList";
import { UserPool } from "@/lib/pools";

interface PoolsFormProps
{
    chainId: number;
    changeChainId(value: number): void;
}

function PoolsForm({chainId, changeChainId}: PoolsFormProps)
{
    const { address: walletAddress, isConnected } = useConnection();
    const chain = findSupportedChain(chainId);

    const [notification, setNotification] = useState<NotificationCardProps | null>(null);

    const [createPoolWindowOpened, setCreatePoolWindowOpened] = useState(false);

    const [poolRefreshKey, setPoolRefreshKey] = useState(0);


    function OnCreatePoolWindowOpen()
    {
        setCreatePoolWindowOpened(true);
    }

    function OnCreatePoolWindowClose()
    {
        setCreatePoolWindowOpened(false);
    }

    function OnAddLiquidity(tokenA: Token, tokenB: Token)
    {
        // Placeholder declarado: a janela de Add Liquidity ainda nao existe
        OnNotification("Add Liquidity screen is not available yet.", "info", 4000);
    }

    function OnLiquidityCreated()
    {
        setPoolRefreshKey(prev => prev + 1); // dispara reload na lista de pools
    }

    function OnNotification(message: string, messageType: "success" | "error" | "info", duration: number)
    {
        setNotification({
            id: Date.now().toString(),
            message,
            messageType,
            duration,
            onClose: () => {
                setNotification(null);
            }
        });
    }

    function OnPoolListItemAddLiquidityButtonClick(tokenA: Token, tokenB: Token)
    {
        OnNotification("Add Liquidity screen is not available yet.", "info", 4000);
    }

    function OnPoolListItemRemoveLiquidityButtonClick(pool: UserPool)
    {
        OnNotification("Remove Liquidity screen is not available yet.", "info", 4000);
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

            <div className="mt-6">
                <div className="swap-label text-xs block mb-2">My Positions</div>
                {!isConnected && (
                    <div className="pool-section p-3 rounded-2xl border">
                        <div className="pool-section-label text-xs">Connect your wallet to see your positions.</div>
                    </div>
                )}

                <UserPoolsList 
                    chainId={chainId} 
                    refreshKey={poolRefreshKey}
                    OnAddLiquidity={OnPoolListItemAddLiquidityButtonClick} 
                    OnRemoveLiquidity={OnPoolListItemRemoveLiquidityButtonClick} 
                />

            </div>

            {createPoolWindowOpened && (
                <CreatePoolWindow
                    chainId={chainId}
                    changeChainId={changeChainId}
                    onClose={OnCreatePoolWindowClose}
                    onAddLiquidity={OnAddLiquidity}
                    onLiquidityCreated={OnLiquidityCreated}
                />
            )}

            {notification && (
                <NotificationCard
                    id={notification.id}
                    message={notification.message}
                    messageType={notification.messageType}
                    duration={notification.duration}
                    onClose={notification.onClose}
                />
            )}
        </div>
    )
}

export default PoolsForm