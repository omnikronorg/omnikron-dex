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
import AddLiquidity from "./AddLiquidity";

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
    const [addLiquidityWindowOpened, setAddLiquidityWindowOpened] = useState(false);

    const [poolRefreshKey, setPoolRefreshKey] = useState(0);


    const [pendingTokenA, setPendingTokenA] = useState<Token | null>(null);
    const [pendingTokenB, setPendingTokenB] = useState<Token | null>(null);


    function OnCreatePoolWindowOpen()
    {
        setCreatePoolWindowOpened(true);
    }

    function OnCreatePoolWindowClose()
    {
        setCreatePoolWindowOpened(false);
    }

    function OnAddLiquidity(tokenA: Token | null | undefined, tokenB: Token | null | undefined)
    {
        setPendingTokenA(tokenA ?? null);
        setPendingTokenB(tokenB ?? null);
        setAddLiquidityWindowOpened(true);
    }

    function OnAddLiquidityWindowClose()
    {
        setAddLiquidityWindowOpened(false);
        setPendingTokenA(null);
        setPendingTokenB(null);
    }

    function OnLiquidityCreated()
    {
        setPoolRefreshKey(prev => prev + 1); // dispara reload na lista de pools
    }

    function OnLiquidityAdded()
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
        OnAddLiquidity(tokenA, tokenB);
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
                    onClick={() => OnAddLiquidity(null, null)}
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

            {addLiquidityWindowOpened && (
                <AddLiquidity
                    chainId={chainId}
                    changeChainId={changeChainId}
                    initialTokenA={pendingTokenA ?? undefined}
                    initialTokenB={pendingTokenB ?? undefined}
                    onAddLiquiditySuccess={OnLiquidityAdded}
                    onClose={OnAddLiquidityWindowClose}
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