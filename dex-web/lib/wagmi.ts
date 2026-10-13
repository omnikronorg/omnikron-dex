import { createConfig, injected } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { supportedChains, supportedTransports } from "@/lib/chains";

// projectId e opcional: sem ele o WalletConnect (QR mobile) fica fora do config
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors = projectId ? [injected(), walletConnect({ projectId })] : [injected()];

function createWagmiConfig()
{
    return createConfig({
        connectors,
        chains: supportedChains,
        transports: supportedTransports,
        ssr: true,        // Hydrate passa a rodar onMount() dentro de useEffect (uma vez), nao no render
    });
}

// O Fast Refresh reavalia este modulo: sem o cache, um novo config "disconnected" substitui o antigo.
// Em dev reaproveitamos a instancia guardada no globalThis (mesmo padrao do PrismaClient no Next).
const globalForWagmi = globalThis as typeof globalThis & { __dexWagmiConfig?: ReturnType<typeof createWagmiConfig> };

export const wagmiConfig = globalForWagmi.__dexWagmiConfig ?? createWagmiConfig();

if(process.env.NODE_ENV !== "production")
{
    globalForWagmi.__dexWagmiConfig = wagmiConfig;
}

// Registra o config para os hooks do wagmi herdarem os tipos (chains literais)
declare module "wagmi" {
    interface Register {
        config: typeof wagmiConfig;
    }
}
