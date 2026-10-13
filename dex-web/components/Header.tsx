import { findNetwork } from "@/lib/networks";
import { ChevronDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import ConnectWalletButton from "./ConnectWalletButton";

interface HeaderProps
{
    chainId: number;
    changeChainId(value: number): void;
}

function Header({chainId, changeChainId}: HeaderProps)
{
    const selectedNetwork = findNetwork(chainId);

    return (
        <header className="header-container w-full border-b px-6 py-4 flex items-center justify-between">

            {/* Esquerda: Logo do Projeto */}
            <Link href="/" className="header-logo flex items-center gap-2">
                <Image
                    src="/brand/omnikron-white.svg"
                    alt="Omnikron"
                    width={36}
                    height={36}
                    className="rounded-full"
                />
                
                <span className="font-bold text-xl tracking-tight hidden sm:block">
                    Omnikron DEX
                </span>

            </Link>

            {/* Centro: Links de Navegação */}
            <nav className="header-nav hidden md:flex items-center gap-1 p-1 rounded-2xl border">
                <Link
                    href="/swap" 
                    className="header-nav-link-selected px-4 py-2 text-sm font-semibold rounded-xl transition-colors"
                >
                    Trade
                </Link>

                <Link 
                    href="/farms" 
                    className="header-nav-link px-4 py-2 text-sm font-semibold rounded-xl transition-colors"
                >
                    Farms
                </Link>

                <Link 
                    href="/staking" 
                    className="header-nav-link px-4 py-2 text-sm font-semibold rounded-xl transition-colors"
                >
                    Staking
                </Link>
            </nav>

            {/* Direita: Rede e Botão de Conectar */}
            <div className="flex items-center gap-3">
                
                {/* Selector de Rede (Ex: Ethereum) */}
                <button className="header-network-select-btn hidden sm:flex items-center gap-2 border transition-colors px-3 py-1.5 rounded-xl text-sm font-medium">
                    <Image
                        src={selectedNetwork.logoURI || "/network/generic.svg"}
                        alt={selectedNetwork.name}
                        width={16} 
                        height={16} 
                    />
                    <span>{selectedNetwork?.name}</span>
                    <ChevronDown className="header-network-select-btn-arrow w-3.5 h-3.5" />
                </button>

                {/* Botão de Conectar - Carteira: Connect Wallet ou endereco conectado */}
                {/* <button className="header-connect-button flex items-center gap-2 transition-colors py-1.5 px-4 rounded-xl font-semibold text-sm shadow-sm">
                    <Wallet className="w-4 h-4" />
                    <span>Connect Wallet</span>
                </button> */}
                <ConnectWalletButton variant="header" />
                
            </div>


        </header>
    )
}

export default Header;