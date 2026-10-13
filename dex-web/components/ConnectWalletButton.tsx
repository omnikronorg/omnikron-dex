"use client"

import { useIsHydrated } from "@/hooks/useIsHydrated";
import { ChevronDown, Wallet } from "lucide-react";
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";

interface ConnectWalletButtonProps
{
    variant: "header" | "swap";
}

// Exibe o endereco conectado de forma reduzida (0x1234...abcd)
function shortAddress(address: string): string
{
    return address.slice(0, 6) + "..." + address.slice(-4);
}

function ConnectWalletButton({variant}: ConnectWalletButtonProps)
{
    const { address, status } = useConnection();
    const isHydrated = useIsHydrated();
    const isResolvingConnection = isHydrated && (status === "connecting" || status === "reconnecting");

   
    const connectors = useConnectors();
    const { mutate: connect, isPending } = useConnect();
    const { mutate: disconnect } = useDisconnect();

    // Antes de hidratar, nada de dado de carteira no markup (evita mismatch SSR x cliente)
    const isWalletReady = isHydrated && connectors.length > 0;


    const isHeader = variant === "header";
    const connectClass = isHeader
        ? "header-connect-button flex items-center gap-2 py-1.5 px-4 rounded-xl font-semibold text-sm shadow-sm"
        : "swap-connect-button w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 mt-3";
    const accountClass = isHeader
        ? "header-account-button border flex items-center gap-2 py-1.5 px-4 rounded-xl font-semibold text-sm"
        : "swap-connect-button w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 mt-3";

    function OnConnectClick()
    {
        // injected() e o connector generico da carteira configurada no navegador
        const connector = connectors.find((item) => item.id === "injected") ?? connectors[0];

        if(!connector)
        {
            return;
        }

        connect({ connector });
    }


    // Conectado: mostra o endereco e o botao de conectar deixa de existir no DOM
    if(address)
    {
        if(isHeader)
        {
            if(isResolvingConnection)
            {
                return (
                    <button className={connectClass} disabled>
                        <span>{status === "connecting" ? "Connecting..." : "Reconnecting..."}</span>
                        <ChevronDown className="header-account-button-arrow w-3.5 h-3.5" />
                    </button>
                );
            }

            return (
                <button className={accountClass} onClick={() => disconnect()} title="Disconnect wallet">
                    <span>{shortAddress(address)}</span>
                    <ChevronDown className="header-account-button-arrow w-3.5 h-3.5" />
                </button>
            );            
        }
        else
        {
            // Hide non-header button when connected
            return null;
        }

    }

    if(isResolvingConnection)
    {
        return (
            <button className={connectClass} disabled>
                <Wallet className="w-4 h-4" />
                <span>{status === "connecting" ? "Connecting..." : "Reconnecting..."}</span>
            </button>
        );
    }

    return (
        <button className={connectClass} onClick={OnConnectClick} disabled={!isWalletReady || isPending}>
            <Wallet className="w-4 h-4" />
            <span>{isHydrated && isPending ? "Connecting..." : "Connect Wallet"}</span>
        </button>
    );
}

export default ConnectWalletButton
