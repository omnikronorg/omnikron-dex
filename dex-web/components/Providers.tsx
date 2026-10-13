"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { reconnect } from "wagmi/actions";
import { setNetworkList, type Network } from "@/lib/networks";
import { setTokenList } from "@/lib/tokens";
import { setChainConfigList, type ChainConfig } from "@/config/chainConfig";
import type { Token as TokenModel } from "@/models/token";

interface ProvidersInitialData
{
    networks: Network[];
    tokens: TokenModel[];
    chainConfigs: ChainConfig[];
}

interface ProvidersProps
{
    children: ReactNode;
    initialData: ProvidersInitialData;
}

function Providers({children, initialData}: ProvidersProps)
{
    // Hydrate the client-side in-memory caches exactly once, synchronously,
    // during the first render (the useState initializer runs before children
    // render). This keeps the first client render identical to the server
    // output, avoiding a hydration mismatch. It is neither a ref nor an effect,
    // so it does not trip the react-hooks refs/set-state-in-effect rules; the
    // setters only assign module-level arrays (idempotent).
    useState(() => {
        setNetworkList(initialData.networks);
        setTokenList(initialData.tokens);
        setChainConfigList(initialData.chainConfigs);
        return true;
    });

    // QueryClient em useState para nao recriar a cada render
    const [queryClient] = useState(() => new QueryClient());

    // Reconecta a carteira apenas depois do mount, mantendo SSR e 1o render do cliente iguais
    // canceled - guarda contra chamada dupla/descartada
    useEffect(() => {
        let cancelled = false;

        if(!cancelled)
        {
            reconnect(wagmiConfig);
        }

        return () => {
        cancelled = true;
        };
    }, []);

    // Reconecta quando a instancia do config muda (Fast Refresh reavalia lib/wagmi.ts e recria o config).
    // Em producao a referencia e estavel, entao roda uma unica vez.
    useEffect(() => {
        reconnect(wagmiConfig);
    }, [wagmiConfig]);


    return (
        <WagmiProvider config={wagmiConfig} >
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
        </WagmiProvider>
    )
}

export default Providers
