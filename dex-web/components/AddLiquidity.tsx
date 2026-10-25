"use client";

import { getAddress, maxUint256, type Address } from "viem";
import { useEffect, useState } from "react";
import { useConnection } from "wagmi";
import Image from "next/image";
import { MinusIcon, PlusIcon, Settings, TriangleAlert, XIcon, ChevronDown } from "lucide-react";

import { factoryAbi } from "@/lib/abi/factory";
import { pairAbi } from "@/lib/abi/pair";
import { routerAbi } from "@/lib/abi/router";
import { erc20Abi } from "viem";
import { findSupportedChain } from "@/lib/chains";
import { getChainConfig } from "@/config/chainConfig";
import {
    callContractRead,
    getTokenBalance,
    getBalance,
    getFriendlyErrorMessage,
    getNativeTokenDecimals,
} from "@/lib/evm";
import { callContractWrite, ContractWriteCall, getTokenApproveFunction } from "@/lib/tx";
import { findToken, getFirstNonNativeToken, getNativeToken, type Token } from "@/lib/tokens";
import { formatEth, isParseableAmountInput, toAmountBigInt } from "@/lib/utils";
import NotificationCard, { NotificationCardProps } from "./NotificationCard";
import ConnectWalletButton from "./ConnectWalletButton";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_SLIPPAGE_BPS = 150; // 1.50%
const DEADLINE_MINUTES = 20;

interface AddLiquidityProps
{
    chainId: number;
    changeChainId(value: number): void;
    onClose(): void;
    initialTokenA?: Token;
    initialTokenB?: Token;
    onAddLiquiditySuccess?(): void;
}

function AddLiquidity({
    chainId,
    changeChainId,
    onClose,
    initialTokenA,
    initialTokenB,
    onAddLiquiditySuccess,
}: AddLiquidityProps)
{
    const { address: walletAddress, isConnected } = useConnection();
    const chain = findSupportedChain(chainId);
    const ammCfg = getChainConfig(chainId);

    const [notification, setNotification] = useState<NotificationCardProps | null>(null);

    const [tokenA, setTokenA] = useState<Token>(initialTokenA ?? getNativeToken(chainId));
    const [tokenB, setTokenB] = useState<Token>(initialTokenB ?? getFirstNonNativeToken(chainId));
    const [tokenADecimals, setTokenADecimals] = useState<number | undefined>(tokenA.decimals);
    const [tokenBDecimals, setTokenBDecimals] = useState<number | undefined>(tokenB.decimals);

    const [depositA, setDepositA] = useState("");
    const [depositB, setDepositB] = useState("");
    const [amountAWei, setAmountAWei] = useState<bigint | null>(null);
    const [amountBWei, setAmountBWei] = useState<bigint | null>(null);

    const [poolExists, setPoolExists] = useState(false);
    const [isPairChecking, setIsPairChecking] = useState(true);
    const [pairAddress, setPairAddress] = useState<Address | null>(null);
    const [reserve0, setReserve0] = useState<bigint>(0n);
    const [reserve1, setReserve1] = useState<bigint>(0n);
    const [token0Addr, setToken0Addr] = useState<Address | null>(null);
    const [token1Addr, setToken1Addr] = useState<Address | null>(null);

    const [isTxPending, setIsTxPending] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);

    // ------------------------------------------------------------------
    // 1. Verificar se o par existe e carregar reservas + ordem dos tokens
    // ------------------------------------------------------------------
    useEffect(() =>
    {
        let isCancelled = false;

        async function checkPair()
        {
            if (!ammCfg || !chain)
            {
                setIsPairChecking(false);
                return;
            }

            setIsPairChecking(true);
            setPoolExists(false);
            setPairAddress(null);

            try
            {
                const factory = getAddress(ammCfg.factory);

                const pair = (await callContractRead(
                    chainId,
                    factory,
                    factoryAbi,
                    "getPair",
                    [getAddress(tokenA.address), getAddress(tokenB.address)],
                )) as Address;

                if (!pair || pair === ZERO_ADDRESS)
                {
                    if (!isCancelled)
                    {
                        setPoolExists(false);
                        setIsPairChecking(false);
                    }
                    return;
                }

                if (!isCancelled)
                {
                    setPairAddress(pair);
                    setPoolExists(true);

                    const [t0, t1] = await Promise.all([
                        callContractRead(chainId, pair, pairAbi, "token0", []) as Promise<Address>,
                        callContractRead(chainId, pair, pairAbi, "token1", []) as Promise<Address>,
                    ]);

                    setToken0Addr(t0);
                    setToken1Addr(t1);

                    const [r0, r1] = (await callContractRead(
                        chainId,
                        pair,
                        pairAbi,
                        "getReserves",
                        [],
                    )) as readonly [bigint, bigint, number];

                    setReserve0(r0);
                    setReserve1(r1);
                }
            }
            catch
            {
                if (!isCancelled)
                {
                    setPoolExists(false);
                }
            }
            finally
            {
                if (!isCancelled) setIsPairChecking(false);
            }
        }

        checkPair();
        return () => { isCancelled = true; };
    }, [chainId, tokenA, tokenB, ammCfg]);

    // ------------------------------------------------------------------
    // 2. Cálculo automático do valor oposto baseado nas reservas
    // ------------------------------------------------------------------
    useEffect(() =>
    {
        if (!poolExists || !pairAddress || !isParseableAmountInput(depositA) && !isParseableAmountInput(depositB))
        {
            return;
        }

        // Qual dos dois inputs foi digitado? O último a mudar é fonte da verdade.
        // Simplificação: se ambos vazios, não calcula.
        if (depositA === "" && depositB === "")
        {
            setAmountAWei(null);
            setAmountBWei(null);
            return;
        }

        const isTokenA_Token0 = token0Addr && token1Addr
            ? getAddress(tokenA.address).toLowerCase() === token0Addr.toLowerCase()
            : true; // fallback

        try
        {
            if (depositA !== "" && isParseableAmountInput(depositA))
            {
                const wei = toAmountBigInt(depositA, tokenADecimals);
                if (!wei || wei <= 0n)
                {
                    setAmountBWei(null);
                    return;
                }
                setAmountAWei(wei);

                // amountB = amountA * reserve1 / reserve0  (se A == token0)
                // amountB = amountA * reserve0 / reserve1  (se A == token1)
                let calculatedB: bigint;
                if (isTokenA_Token0)
                {
                    calculatedB = (wei * reserve1) / reserve0;
                }
                else
                {
                    calculatedB = (wei * reserve0) / reserve1;
                }
                setAmountBWei(calculatedB);
            }
            else if (depositB !== "" && isParseableAmountInput(depositB))
            {
                const wei = toAmountBigInt(depositB, tokenBDecimals);
                if (!wei || wei <= 0n)
                {
                    setAmountAWei(null);
                    return;
                }
                setAmountBWei(wei);

                let calculatedA: bigint;
                if (isTokenA_Token0)
                {
                    calculatedA = (wei * reserve0) / reserve1;
                }
                else
                {
                    calculatedA = (wei * reserve1) / reserve0;
                }
                setAmountAWei(calculatedA);
            }
        }
        catch
        {
            // Ignora erros de cálculo durante a digitação
        }
    }, [depositA, depositB, poolExists, pairAddress, reserve0, reserve1, token0Addr, token1Addr, tokenA, tokenB, tokenADecimals, tokenBDecimals]);

    // ------------------------------------------------------------------
    // 3. Handlers de input (mantém apenas um lado editável como fonte)
    // ------------------------------------------------------------------
    function OnDepositAChange(value: string)
    {
        setDepositA(value);
        if (value === "")
        {
            setDepositB("");
            setAmountAWei(null);
            setAmountBWei(null);
        }
    }

    function OnDepositBChange(value: string)
    {
        setDepositB(value);
        if (value === "")
        {
            setDepositA("");
            setAmountAWei(null);
            setAmountBWei(null);
        }
    }

    // ------------------------------------------------------------------
    // 4. Execução da transação
    // ------------------------------------------------------------------
    async function OnAddLiquidityClick()
    {
        if (!walletAddress || !isConnected || !pairAddress || isTxPending)
        {
            return;
        }

        if (!amountAWei || !amountBWei || amountAWei <= 0n || amountBWei <= 0n)
        {
            setTxError("Informe valores válidos para ambos os tokens.");
            return;
        }

        if (!chain || !ammCfg)
        {
            setTxError("Rede não suportada.");
            return;
        }

        setIsTxPending(true);
        setTxError(null);

        try
        {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_MINUTES * 60);
            const router = getAddress(ammCfg.router);

            const isNativeA = tokenA.isNative === true;
            const isNativeB = tokenB.isNative === true;

            const amountAMin = (amountAWei * (10000n - BigInt(DEFAULT_SLIPPAGE_BPS))) / 10000n;
            const amountBMin = (amountBWei * (10000n - BigInt(DEFAULT_SLIPPAGE_BPS))) / 10000n;

            // Se ambos ERC-20, precisa de allowance antes
            if (!isNativeA && !isNativeB)
            {
                // Approve tokenA
                const allowanceA = await callContractRead(
                    chainId,
                    getAddress(tokenA.address),
                    erc20Abi,
                    "allowance",
                    [walletAddress, router],
                ) as bigint;

                if (allowanceA < amountAWei)
                {
                    const approveA: ContractWriteCall = getTokenApproveFunction(
                        getAddress(tokenA.address),
                        router,
                        maxUint256,
                    );
                    await callContractWrite(chainId, approveA);
                }

                // Approve tokenB
                const allowanceB = await callContractRead(
                    chainId,
                    getAddress(tokenB.address),
                    erc20Abi,
                    "allowance",
                    [walletAddress, router],
                ) as bigint;

                if (allowanceB < amountBWei)
                {
                    const approveB: ContractWriteCall = getTokenApproveFunction(
                        getAddress(tokenB.address),
                        router,
                        maxUint256,
                    );
                    await callContractWrite(chainId, approveB);
                }

                const call: ContractWriteCall = {
                    address: router,
                    abi: routerAbi,
                    functionName: "addLiquidity",
                    args: [
                        getAddress(tokenA.address),
                        getAddress(tokenB.address),
                        amountAWei,
                        amountBWei,
                        amountAMin,
                        amountBMin,
                        walletAddress,
                        deadline,
                    ],
                };

                await callContractWrite(chainId, call);
            }
            else
            {
                // Um dos lados é nativo -> addLiquidityNative
                const erc20Token = isNativeA ? tokenB : tokenA;
                const amountTokenDesired = isNativeA ? amountBWei : amountAWei;
                const amountNativeDesired = isNativeA ? amountAWei : amountBWei;

                const allowance = await callContractRead(
                    chainId,
                    getAddress(erc20Token.address),
                    erc20Abi,
                    "allowance",
                    [walletAddress, router],
                ) as bigint;

                if (allowance < amountTokenDesired)
                {
                    const approveCall: ContractWriteCall = getTokenApproveFunction(
                        getAddress(erc20Token.address),
                        router,
                        maxUint256,
                    );
                    await callContractWrite(chainId, approveCall);
                }

                const call: ContractWriteCall = {
                    address: router,
                    abi: routerAbi,
                    functionName: "addLiquidityNative",
                    args: [
                        getAddress(erc20Token.address),
                        amountTokenDesired,
                        amountTokenDesired, // amountTokenMin (exato por enquanto; pode usar slippage)
                        amountNativeDesired, // amountNativeMin
                        walletAddress,
                        deadline,
                    ],
                    value: amountNativeDesired,
                };

                await callContractWrite(chainId, call);
            }

            setNotification({
                id: Date.now().toString(),
                message: "Liquidity added successfully.",
                messageType: "success",
                duration: 4000,
                onClose: () => setNotification(null),
            });

            onAddLiquiditySuccess?.();
            onClose();
        }
        catch (error: unknown)
        {
            setTxError(getFriendlyErrorMessage(error));
        }
        finally
        {
            setIsTxPending(false);
        }
    }

    // ------------------------------------------------------------------
    // 5. Notificação
    // ------------------------------------------------------------------
    function OnNotification(message: string, type: "success" | "error" | "info", duration: number)
    {
        setNotification({
            id: Date.now().toString(),
            message,
            messageType: type,
            duration,
            onClose: () => setNotification(null),
        });
    }

    // ------------------------------------------------------------------
    // 6. Render
    // ------------------------------------------------------------------
    const network = findNetwork(chainId); // se precisar exibir rede

    return (
        <div className="swap-card w-full max-w-[480px] p-4 rounded-3xl border shadow-xl">
            <div className="flex justify-between items-center mb-3 px-1">
                <div className="flex gap-4 font-medium">
                    <button
                        onClick={() => { onClose(); }}
                        className="swap-header-button pb-1"
                    >
                        <XIcon className="w-4 h-4" /> Back
                    </button>
                    <span className="swap-header-button-selected border-b-2 pb-1">Add Liquidity</span>
                </div>
            </div>

            {!isConnected && (
                <ConnectWalletButton variant="swap" />
            )}

            {isConnected && !walletAddress && (
                <div className="pool-section-label text-xs text-center mb-3">Connecting wallet...</div>
            )}

            {isConnected && walletAddress && (
                <>
                    {/* Seleção de par (simplificada; pode ser um modal SwapTokenSelect se quiser) */}
                    <div className="flex gap-2 mb-3">
                        <button
                            onClick={() => { /* abrir seleção de token A */ }}
                            className="pool-token-button flex-1 flex items-center justify-between px-3 py-2 rounded-xl border transition-colors"
                        >
                            <Image src={tokenA.logoURI} alt={tokenA.symbol} width={20} height={20} className="rounded-full" />
                            <span>{tokenA.symbol}</span>
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        <span className="pool-ratio-equals text-sm">=</span>
                        <button
                            onClick={() => { /* abrir seleção de token B */ }}
                            className="pool-token-button flex-1 flex items-center justify-between px-3 py-2 rounded-xl border transition-colors"
                        >
                            <Image src={tokenB.logoURI} alt={tokenB.symbol} width={20} height={20} className="rounded-full" />
                            <span>{tokenB.symbol}</span>
                            <ChevronDown className="w-3 h-3" />
                        </button>
                    </div>

                    {isPairChecking && (
                        <div className="pool-section-label text-xs text-center">Checking pool...</div>
                    )}

                    {!poolExists && !isPairChecking && (
                        <div className="pool-note p-3 rounded-xl border mt-3 text-xs text-center">
                            The pair <strong>{tokenA.symbol}/{tokenB.symbol}</strong> does not exist yet.
                        </div>
                    )}
                    {!poolExists && !isPairChecking && (
                        <button
                            onClick={() => {
                                // Chama o pai para abrir CreatePoolWindow com este par pré-selecionado
                                onClose();
                                // O pai deve passar um callback para abrir a CreatePoolWindow com tokenA/tokenB
                                // Exemplo: onCreatePoolWithPair?.(tokenA, tokenB)
                            }}
                            className="swap-action-button w-full mt-3 transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"
                        >
                            <PlusIcon className="w-4 h-4" />
                            Create Pool
                        </button>
                    )}

                    {poolExists && !isPairChecking && (
                        <>
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="swap-label text-xs block mb-1">{tokenA.symbol} deposit</label>
                                    <div className="flex items-center justify-between">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="0"
                                            value={depositA}
                                            onChange={(e) => OnDepositAChange(e.target.value)}
                                            className="swap-input bg-transparent w-full focus:outline-none font-medium"
                                        />
                                        <span className="text-base font-semibold">{tokenA.symbol}</span>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <label className="swap-label text-xs block mb-1">{tokenB.symbol} deposit</label>
                                    <div className="flex items-center justify-between">
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="0"
                                            value={depositB}
                                            onChange={(e) => OnDepositBChange(e.target.value)}
                                            className="swap-input bg-transparent w-full focus:outline-none font-medium"
                                        />
                                        <span className="text-base font-semibold">{tokenB.symbol}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="swap-label text-xs block mt-3 mb-1">Estimated share</div>
                            <div className="text-xs text-right">{/* calcular share se quiser */}0.00%</div>

                            <div className="swap-tx-error text-xs mt-2 text-center">{txError}</div>

                            <button
                                onClick={OnAddLiquidityClick}
                                disabled={isTxPending || !amountAWei || !amountBWei}
                                className={
                                    (isTxPending || !amountAWei || !amountBWei
                                        ? "swap-action-button-disabled"
                                        : "swap-action-button") +
                                    " w-full mt-3 transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"
                                }
                            >
                                {isTxPending ? "Adding..." : "Add Liquidity"}
                            </button>
                        </>
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
                </>
            )}
        </div>
    );
}

export default AddLiquidity;

// Helper local se findNetwork não estiver importado
function findNetwork(chainId: number | undefined)
{
    // Implementação simplificada; no PoolsForm use import { findNetwork } from "@/lib/networks";
    return { id: chainId ?? 0, name: "Unknown", symbol: "", logoURI: "", wrappedNative: "" };
}
