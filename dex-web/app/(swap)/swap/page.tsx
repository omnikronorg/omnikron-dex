"use client"

import Header from "@/components/Header";
import SwapForm from "@/components/SwapForm";
import { supportedChains } from "@/lib/chains";
import { useEffect, useState } from "react";
import { useConnection, useSwitchChain } from "wagmi";

function SwapPage()
{
    const [chainId, setChainId] = useState(1);

    // chainId da conexao: reflete a rede real da carteira, mesmo fora do config do wagmi
    const { chainId: walletChainId } = useConnection();
    const { mutate: switchChain } = useSwitchChain();

    const [isTokenSelectOpen, setIsTokenSelectOpen] = useState(false);
    const [isTokenSelectFrom, setIsTokenSelectFrom] = useState(true);


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
        // min-h-screen: Mantém o fundo cobrindo a tela toda
        // flex justify-center: Mantém o card centralizado na horizontal
        // items-start: Alinha o conteúdo no topo da página
        // pt-[40px]: Aplica exatamente os 40px de distância do topo
        <div>
            <Header chainId={activeChainId} changeChainId={changeChainId} />
            <div className="min-h-screen w-full flex justify-center items-start pt-[40px] p-4">
                <SwapForm 
                    key={activeChainId} 
                    chainId={activeChainId} 
                    changeChainId={changeChainId} 
                    isTokenSelectOpen={isTokenSelectOpen}
                    setIsTokenSelectOpen={setIsTokenSelectOpen}
                    isTokenSelectFrom={isTokenSelectFrom}
                    setIsTokenSelectFrom={setIsTokenSelectFrom}
                />
            </div>
        </div>
    )
}

export default SwapPage;