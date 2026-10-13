import { findSupportedChain } from "@/lib/chains";
import { findNetwork, getNetworkList } from "@/lib/networks";
import { getTokenList, Token } from "@/lib/tokens";
import { formatEth, formatQuoteAmount } from "@/lib/utils";
import { SearchIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Address, erc20Abi, getAddress } from "viem";
import { useBalance, useReadContracts } from "wagmi";

interface TokenSelectProps
{
    onClose(): void;
    isTokenSelectFrom: boolean;
    chainId: number;
    walletAddress?: Address;
    OnTokenSelectChainIdChanged(value: number): void;
    OnTokenSelected(tokenAddress: string): void;
}

function getNetwork(chainId: number)
{
    const record = findNetwork(chainId);

    if(record == null)
    {
        return {
            "id": chainId,
            "name": "Unknown",
            "symbol": "NONE",
            "logoURI": "/network/generic.svg"
        };
    }

    return record;
}


function SwapTokenSelect({onClose, isTokenSelectFrom, chainId, walletAddress, OnTokenSelectChainIdChanged, OnTokenSelected}: TokenSelectProps)
{
    const networkList = getNetworkList();
    const tokenList = getTokenList(chainId);

        // Hooks exigem o id LITERAL da chain do config (o prop e number): mesmo padrao do SwapForm
    const chain = findSupportedChain(chainId);

    const erc20Tokens = tokenList.filter((token) => !token.isNative);
    const nativeToken = tokenList.find((token) => token.isNative);

    // 1 multicall para todos os ERC-20 da lista; desabilita sem carteira conectada
    const balancesQuery = useReadContracts({
        chainId: chain?.id,
        contracts: walletAddress
            ? erc20Tokens.map((token) => ({
                address: getAddress(token.address),
                abi: erc20Abi,
                functionName: "balanceOf" as const,
                args: [ walletAddress ],
            }))
            : [],
        query: { enabled: !!walletAddress && erc20Tokens.length > 0 },
    });

    // O token nativo tem o endereco do wrappedNative: balanceOf daria o saldo wrapped.
    // useBalance le o saldo nativo (wei) e ainda devolve decimals/symbol
    const nativeBalanceQuery = useBalance({
        address: walletAddress,
        chainId: chain?.id,
        query: { enabled: !!walletAddress && !!nativeToken },
    });

    // isLoading = primeiro fetch (sem dados). Refetch nao reabre o placeholder
    const isLoadingBalances = balancesQuery.isLoading || nativeBalanceQuery.isLoading;

    function getTokenBalance(token: Token): bigint | undefined
    {
        if(token.isNative)
        {
            return nativeBalanceQuery.data?.value;
        }

        if(!walletAddress)
        {
            return undefined;
        }

        // A ordem de data segue a ordem de contracts
        const index = erc20Tokens.findIndex((item) => item.address.toLowerCase() === token.address.toLowerCase());
        const entry = balancesQuery.data?.[index];

        return entry && entry.status == "success" ? entry.result as bigint : undefined;
    }

    function formatBalance(token: Token): string
    {
        if(isLoadingBalances)
        {
            return "...";
        }

        const value = getTokenBalance(token);

        // undefined = token quebrado/RPC falhou (allowFailure); 0n = saldo realmente zero
        if(value == null)
        {
            return "-";
        }

        // return formatEth(value, token.decimals) || "0";
        
        // Exibicao: no maximo 6 casas, truncando (nunca para cima)
        const text = formatQuoteAmount(value, token.decimals);

        // Positivo que sumiu no truncamento: melhor que exibir "0"
        const smallestVisible = 10n ** BigInt(Math.max(0, (token.decimals ?? 18) - 6));

        if(value > 0n && value < smallestVisible)
        {
            return "<0.000001";
        }

        return text || "0.00";
    }


    return (
        <div className="swap-modal-overlay fixed pt-45 inset-0 z-50 overflow-y-auto h-full w-full flex items-start justify-center" onClick={onClose}>
            <div className="swap-modal-area p-4 border w-96 shadow-lg rounded-3xl" onClick={(e) => e.stopPropagation()}>
                <div className="relative flex items-center min-h-[40px] mb-4">
                    <button
                        onClick={onClose}
                        className="swap-settings-modal-close-button absolute right-0 top-1/2 -translate-y-1/2 px-2 py-2 text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 transition-colors"
                    >
                        <XIcon />
                    </button>

                    <h3 className="swap-modal-title text-base font-bold">
                        Select a token ({isTokenSelectFrom ? "From" : "To"})
                    </h3>
                </div>

                <div className="swap-modal-body">
                    {/* 1. Barra de Pesquisa */}
                    <div className="swap-modal-search-container relative w-full flex items-center border rounded-2xl px-3.5 py-2.5 transition-all mb-4">
                        <SearchIcon className="swap-modal-search-icon w-4 h-4 mr-2" />
                        
                        <input
                            type="text"
                            placeholder="Search name or paste address"
                            className="swap-modal-search-input bg-transparent w-full focus:outline-none text-sm font-medium"
                        />
                    </div>

                    {/* Network */}
                    <div className="mb-4">
                        <div className="text-sm">Network: {getNetwork(chainId).name}</div>
                        <div className="flex flex-wrap gap-2">
                            {networkList.map((network) => (
                                <button
                                    key={network.id}
                                    aria-label={network.name}
                                    className="swap-modal-tag cursor-pointer flex items-center gap-1.5 border rounded-xl px-3 py-1.5"
                                    onClick={() => OnTokenSelectChainIdChanged(network.id)}
                                >
                                    <Image
                                        src={network.logoURI}
                                        alt={network.symbol}
                                        width={24}
                                        height={24}
                                        className="rounded-full"
                                    />
                                    {/* <span className="text-xs">{network.name}</span> */}
                                </button>
                            ))}
                        </div>

                    </div>

                    {/* Divisor Sutil */}
                    <div className="swap-modal-divider w-full h-[1px] my-1 mb-4" />


                    {/* 2. Tokens Populares (Tags Rápidas) */}
                    <div className="mb-4">
                        <div className="text-sm">Popular</div>
                        <div className="flex flex-wrap gap-2">
                            {tokenList.map((token) => (
                                <button
                                    key={token.symbol}
                                    className="swap-modal-tag flex items-center gap-1.5 border transition-all px-3 py-1.5 rounded-xl cursor-pointer text-sm font-semibold"
                                >
                                    <Image
                                        src={token.logoURI}
                                        alt={token.symbol}
                                        width={16}
                                        height={16}
                                        className="swap-modal-popular-token-icon rounded-full"
                                    />
                                    <span>{token.symbol}</span>
                                </button>
                            ))}
                        </div>
                    </div>


                    {/* Divisor Sutil */}
                    <div className="swap-modal-divider w-full h-[1px] my-1 mb-2" />

                    {/* 3. Lista Completa de Tokens */}
                    <div>
                        <div className="text-sm">Select a token</div>
                        <div className="swap-modal-list flex flex-col max-h-[280px] overflow-y-auto pr-1 gap-1">
                            {tokenList.map((token) => (
                                <button
                                    key={token.symbol}
                                    className="swap-modal-row flex items-center justify-between w-full p-2 rounded-2xl transition-colors cursor-pointer text-left"
                                    onClick={() => {OnTokenSelected(token.address)}}
                                >
                                    <div className="flex items-center gap-3">
                                    <Image
                                        src={token.logoURI}
                                        alt={token.symbol}
                                        width={36}
                                        height={36}
                                        className="swap-modal-row-icon rounded-full p-0.5"
                                    />
                                    <div className="flex flex-col">
                                        <span className="swap-modal-row-name text-sm font-bold leading-tight">
                                        {token.name}
                                        </span>
                                        <span className="swap-modal-row-symbol text-xs">
                                        {token.symbol}
                                        </span>
                                    </div>
                                    </div>

                                    <div className="text-right flex flex-col items-end">
                                    <span className="swap-modal-row-balance text-sm font-bold">
                                        {formatBalance(token)}
                                    </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

export default SwapTokenSelect;