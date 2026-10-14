"use client"

import Header from "@/components/Header";
import PoolsForm from "@/components/PoolsForm";
import { supportedChains } from "@/lib/chains";
import { useState } from "react";
import { useConnection, useSwitchChain } from "wagmi";

function PoolsPage()
{
    const [chainId, setChainId] = useState(1);

    // chainId da conexao: reflete a rede real da carteira, mesmo fora do config do wagmi
    const { chainId: walletChainId } = useConnection();
    const { mutate: switchChain } = useSwitchChain();

    // Conectado: a carteira manda na tela. Desconectado: vale a selecao local
    const activeChainId = walletChainId ?? chainId;

    function changeChainId(newValue: number)
    {
        if(!walletChainId)
        {
            setChainId(newValue);
            return;
        }

        // Tela -> carteira: switchChain so aceita chains configuradas no wagmi
        const target = supportedChains.find((chain) => chain.id === newValue);

        if(!target)
        {
            return;
        }

        switchChain({ chainId: target.id });
    }

    return (
        <div>
            <Header chainId={activeChainId} changeChainId={changeChainId} />
            <div className="min-h-screen w-full flex justify-center items-start pt-[40px] p-4">
                <PoolsForm 
                    key={activeChainId} 
                    chainId={activeChainId} 
                    changeChainId={changeChainId} 
                />
            </div>
        </div>
    )
}

export default PoolsPage;