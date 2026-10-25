"use client"

import { ChevronDown, PlusIcon, Settings, TriangleAlert, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAddress, maxUint256, type Address } from "viem";
import { useConnection } from "wagmi";
import ConnectWalletButton from "./ConnectWalletButton";
import NotificationCard, { NotificationCardProps } from "./NotificationCard";
import SwapSettings from "./SwapSettings";
import SwapTokenSelect from "./SwapTokenSelect";
import { getChainConfig } from "@/config/chainConfig";
import { factoryAbi } from "@/lib/abi/factory";
import { pairAbi } from "@/lib/abi/pair";
import { routerAbi } from "@/lib/abi/router";
import { findSupportedChain } from "@/lib/chains";
import { callContractRead, getAllowance, getBalance, getFriendlyErrorMessage, getNativeTokenDecimals, getTokenBalance, getTokenDecimals } from "@/lib/evm";
import { findToken, getFirstNonNativeToken, getNativeToken, getTokenList, Token } from "@/lib/tokens";
import { callContractWrite, ContractWriteCall, getTokenApproveFunction } from "@/lib/tx";
import { formatEth, isValidAmountInput, toAmountBigInt } from "@/lib/utils";

interface AddLiquidityProps
{
    chainId: number;
    changeChainId(value: number): void;
    onClose(): void;
    initialTokenA?: Token;
    initialTokenB?: Token;
    onAddLiquiditySuccess?(): void;
    onCreatePool?(tokenA: Token, tokenB: Token): void;
}

// Snapshot do par existente: reservas na ordem do proprio par + supply de LP
interface PoolInfo
{
    pair: Address;
    token0: Address;
    token1: Address;
    reserve0: bigint;
    reserve1: bigint;
    totalSupply: bigint;
    feeBps: number;
}

// Piso de slippage quando o usuario deixa em "Auto" (mesmo default do SwapForm/CreatePoolWindow)
const DEFAULT_SLIPPAGE_AUTO = 1.5;

// Fallback do fee quando o par nao expoe SWAP_FEE_BPS
const DEFAULT_POOL_FEE_BPS = 30;

const DEADLINE_MINUTES = 20;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Espelha o valor calculado sem poluir o input: no maximo 8 casas, truncando
function formatDepositAmount(value: bigint, decimals: number | undefined): string
{
    if(value <= 0n)
    {
        return "";
    }

    const text = formatEth(value, decimals);

    if(text.includes(".") == false)
    {
        return text;
    }

    const [ whole, fraction ] = text.split(".");
    const trimmedFraction = fraction.slice(0, 8).replace(/0+$/, "");

    // Poeira que truncaria para zero mantem a precisao cheia em vez de exibir "0"
    if(trimmedFraction.length == 0)
    {
        return text;
    }

    return whole + "." + trimmedFraction;
}

// O fee e constante no Pair: le de forma defensiva para um par fora do padrao nao quebrar a tela
async function readPairFeeBps(chainId: number, pair: Address): Promise<number>
{
    try
    {
        const bps = await callContractRead(chainId, pair, pairAbi, "SWAP_FEE_BPS", []) as bigint;

        return Number(bps);
    }
    catch
    {
        return DEFAULT_POOL_FEE_BPS;
    }
}

function AddLiquidity({chainId, changeChainId, onClose, initialTokenA, initialTokenB, onAddLiquiditySuccess, onCreatePool}: AddLiquidityProps)
{
    const { address: walletAddress, isConnected } = useConnection();

    const chain = findSupportedChain(chainId);
    const ammCfg = useMemo(() => getChainConfig(chainId), [chainId]);
    const isUnsupportedNetwork = !chain || !ammCfg || getTokenList(chainId).length == 0;

    const [notification, setNotification] = useState<NotificationCardProps | null>(null);

    // Par: A e o primeiro lado (vem do card da pool ou e a moeda nativa), B o segundo
    const [tokenA, setTokenA] = useState<Token>(initialTokenA ?? getNativeToken(chainId));
    const [tokenB, setTokenB] = useState<Token>(initialTokenB ?? getFirstNonNativeToken(chainId));
    const [tokenADecimals, setTokenADecimals] = useState<number | undefined>(tokenA.decimals);
    const [tokenBDecimals, setTokenBDecimals] = useState<number | undefined>(tokenB.decimals);
    const [tokenABalance, setTokenABalance] = useState<bigint | undefined>(undefined);
    const [tokenBBalance, setTokenBBalance] = useState<bigint | undefined>(undefined);

    // Depositos: o lado editado e a fonte da verdade; o outro espelha a razao das reservas
    const [depositA, setDepositA] = useState("");
    const [depositB, setDepositB] = useState("");

    // Par existente: reservas, ordem dos tokens e supply de LP alimentam a razao e o share
    const [pool, setPool] = useState<PoolInfo | null>(null);
    const [isPairChecking, setIsPairChecking] = useState(true);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [slippage, setSlippage] = useState(0);
    const [inputSlippage, setInputSlippage] = useState("");
    const [isSlippageAuto, setIsSlippageAuto] = useState(true);
    const [isSlippageHigh, setIsSlippageHigh] = useState(false);
    const [isSlippageVeryHigh, setIsSlippageVeryHigh] = useState(false);

    const [isTokenSelectOpen, setIsTokenSelectOpen] = useState(false);
    const [tokenSelectSide, setTokenSelectSide] = useState<"a" | "b">("a");

    const [isTxPending, setIsTxPending] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);

    // Incrementado apos transacoes que mexem em saldo/reservas para forcar a releitura
    const [refreshKey, setRefreshKey] = useState(0);

    // O card de sucesso vive dentro deste modal: da um tempo antes de fechar
    const closeTimerRef = useRef<number | null>(null);

    // Derivado no render: par (texto, wei) sempre coerente com os decimals do token
    const depositAWei = useMemo(() => toAmountBigInt(depositA, tokenADecimals), [depositA, tokenADecimals]);
    const depositBWei = useMemo(() => toAmountBigInt(depositB, tokenBDecimals), [depositB, tokenBDecimals]);

    const isSameToken = tokenA.address.toLowerCase() == tokenB.address.toLowerCase();

    // As reservas seguem a ordem do par, que nao e necessariamente (A, B)
    const isTokenAFirst = pool != null && pool.token0.toLowerCase() == tokenA.address.toLowerCase();
    const reserveA = pool == null ? null : (isTokenAFirst ? pool.reserve0 : pool.reserve1);
    const reserveB = pool == null ? null : (isTokenAFirst ? pool.reserve1 : pool.reserve0);

    // LP mintado = min(amountA * totalSupply / reserveA, amountB * totalSupply / reserveB)
    const poolShare = useMemo(() =>
    {
        if(pool == null || depositAWei == null || depositBWei == null)
        {
            return null;
        }

        const isFirst = pool.token0.toLowerCase() == tokenA.address.toLowerCase();
        const reserveForA = isFirst ? pool.reserve0 : pool.reserve1;
        const reserveForB = isFirst ? pool.reserve1 : pool.reserve0;

        if(depositAWei <= 0n || depositBWei <= 0n || reserveForA <= 0n || reserveForB <= 0n || pool.totalSupply <= 0n)
        {
            return null;
        }

        const mintedFromA = (depositAWei * pool.totalSupply) / reserveForA;
        const mintedFromB = (depositBWei * pool.totalSupply) / reserveForB;
        const minted = mintedFromA < mintedFromB ? mintedFromA : mintedFromB;
        const nextTotalSupply = pool.totalSupply + minted;

        if(minted <= 0n || nextTotalSupply <= 0n)
        {
            return null;
        }

        // Percentual com 4 casas, so com inteiros: (minted * 1_000_000) / nextTotalSupply
        const scaled = (minted * 1000000n) / nextTotalSupply;
        const whole = scaled / 10000n;
        const fraction = (scaled % 10000n).toString().padStart(4, "0");

        return whole.toString() + "." + fraction + "%";
    }, [pool, tokenA, depositAWei, depositBWei]);

    // Motivo do bloqueio, derivado no render (sem estado extra)
    let addMessage: string | null = null;

    if(isUnsupportedNetwork)
    {
        addMessage = "Unsupported network";
    }
    else if(isSameToken)
    {
        addMessage = "Select two different tokens";
    }
    else if(isPairChecking)
    {
        addMessage = "Checking pool...";
    }
    else if(pool == null)
    {
        addMessage = "Pool not found";
    }
    else if(depositAWei == null || depositAWei <= 0n || depositBWei == null || depositBWei <= 0n)
    {
        addMessage = "Enter deposit amounts";
    }
    else if(tokenABalance != null && depositAWei != null && depositAWei > tokenABalance)
    {
        addMessage = "Not enough " + tokenA.symbol;
    }
    else if(tokenBBalance != null && depositBWei != null && depositBWei > tokenBBalance)
    {
        addMessage = "Not enough " + tokenB.symbol;
    }

    const isAddDisabled = addMessage != null || isTxPending;

    // Saldos/decimals: o nativo usa getBalance (wei), o ERC-20 usa balanceOf
    useEffect(() =>
    {
        let isCancelled = false;

        async function readTokenState(targetChainId: number, token: Token)
        {
            if(!walletAddress)
            {
                return { balance: undefined as bigint | undefined, decimals: token.decimals };
            }

            try
            {
                if(token.isNative)
                {
                    return {
                        balance: await getBalance(targetChainId, walletAddress),
                        decimals: getNativeTokenDecimals(targetChainId),
                    };
                }

                const tokenAddress = getAddress(token.address);

                return {
                    balance: await getTokenBalance(targetChainId, walletAddress, tokenAddress),
                    decimals: await getTokenDecimals(targetChainId, tokenAddress),
                };
            }
            catch
            {
                // Token fora da rede ou RPC indisponivel: nao manter saldo antigo na tela
                return { balance: undefined as bigint | undefined, decimals: token.decimals };
            }
        }

        async function syncBalances()
        {
            if(isUnsupportedNetwork || !walletAddress)
            {
                setTokenABalance(undefined);
                setTokenBBalance(undefined);
                return;
            }

            const nextA = await readTokenState(chainId, tokenA);

            if(isCancelled) return;

            setTokenABalance(nextA.balance);
            setTokenADecimals(nextA.decimals);

            const nextB = await readTokenState(chainId, tokenB);

            if(isCancelled) return;

            setTokenBBalance(nextB.balance);
            setTokenBDecimals(nextB.decimals);
        }

        syncBalances();

        // Cleanup: descarta a resposta de um par que ja nao e o atual (evita corrida)
        return () => { isCancelled = true; };
    }, [chainId, walletAddress, isUnsupportedNetwork, tokenA, tokenB, refreshKey]);

    // O par ja existe? Sem par (ou sem liquidez) o Router nao consegue mintar LP
    useEffect(() =>
    {
        let isCancelled = false;

        async function readPool()
        {
            setPool(null);

            if(!ammCfg || isSameToken)
            {
                setIsPairChecking(false);
                return;
            }

            setIsPairChecking(true);

            try
            {
                const factory = getAddress(ammCfg.factory);
                const pair = await callContractRead(
                    chainId,
                    factory,
                    factoryAbi,
                    "getPair",
                    [ getAddress(tokenA.address), getAddress(tokenB.address) ],
                ) as Address;

                if(!pair || pair.toLowerCase() == ZERO_ADDRESS)
                {
                    if(!isCancelled) setIsPairChecking(false);
                    return;
                }

                const pairAddress = getAddress(pair);
                const reserves = await callContractRead(chainId, pairAddress, pairAbi, "getReserves", []) as readonly [bigint, bigint, number];

                // Par criado direto na Factory pode existir sem reservas: nao serve para adicionar liquidez
                if(reserves[0] <= 0n || reserves[1] <= 0n)
                {
                    if(!isCancelled) setIsPairChecking(false);
                    return;
                }

                const [ token0, token1, totalSupply, feeBps ] = await Promise.all([
                    callContractRead(chainId, pairAddress, pairAbi, "token0", []) as Promise<Address>,
                    callContractRead(chainId, pairAddress, pairAbi, "token1", []) as Promise<Address>,
                    callContractRead(chainId, pairAddress, pairAbi, "totalSupply", []) as Promise<bigint>,
                    readPairFeeBps(chainId, pairAddress),
                ]);

                if(isCancelled) return;

                setPool({
                    pair: pairAddress,
                    token0: getAddress(token0),
                    token1: getAddress(token1),
                    reserve0: reserves[0],
                    reserve1: reserves[1],
                    totalSupply,
                    feeBps,
                });
            }
            catch
            {
                if(!isCancelled) setPool(null);
            }
            finally
            {
                if(!isCancelled) setIsPairChecking(false);
            }
        }

        readPool();

        return () => { isCancelled = true; };
    }, [chainId, ammCfg, tokenA, tokenB, isSameToken, refreshKey]);

    // O timer de fechamento pertence a este modal: cancela se ele sair antes
    useEffect(() =>
    {
        return () =>
        {
            if(closeTimerRef.current != null)
            {
                window.clearTimeout(closeTimerRef.current);
            }
        };
    }, []);

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

    function OnTokenSelectAButtonClick()
    {
        setTokenSelectSide("a");
        setIsTokenSelectOpen(true);
    }

    function OnTokenSelectBButtonClick()
    {
        setTokenSelectSide("b");
        setIsTokenSelectOpen(true);
    }

    function OnTokenSelectChainIdChanged(value: number)
    {
        setIsTokenSelectOpen(false);

        if(value == chainId)
        {
            return;
        }

        // A pagina remonta o PoolsForm com a nova rede (key={chainId})
        changeChainId(value);
    }

    function OnTokenSelected(tokenAddress: string)
    {
        setIsTokenSelectOpen(false);

        const token = findToken(chainId, tokenAddress);

        if(!token)
        {
            return;
        }

        if(tokenSelectSide == "a")
        {
            setTokenA(token);
            setTokenADecimals(token.decimals);
        }
        else
        {
            setTokenB(token);
            setTokenBDecimals(token.decimals);
        }

        // O par mudou: valores e saldos do par anterior nao valem mais
        setDepositA("");
        setDepositB("");
        setTokenABalance(undefined);
        setTokenBBalance(undefined);
        setTxError(null);
    }

    function OnDepositAChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        setDepositA(value);

        if(value.trim().length == 0)
        {
            setDepositB("");
            return;
        }

        const amountA = toAmountBigInt(value, tokenADecimals);

        if(amountA == null || amountA <= 0n)
        {
            setDepositB("");
            return;
        }

        // Sem reservas on-chain nao existe razao para espelhar
        if(reserveA == null || reserveB == null || reserveA <= 0n || reserveB <= 0n)
        {
            return;
        }

        // amountB = amountA * reserveB / reserveA
        setDepositB(formatDepositAmount((amountA * reserveB) / reserveA, tokenBDecimals));
    }

    function OnDepositBChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        setDepositB(value);

        if(value.trim().length == 0)
        {
            setDepositA("");
            return;
        }

        const amountB = toAmountBigInt(value, tokenBDecimals);

        if(amountB == null || amountB <= 0n)
        {
            setDepositA("");
            return;
        }

        if(reserveA == null || reserveB == null || reserveA <= 0n || reserveB <= 0n)
        {
            return;
        }

        // amountA = amountB * reserveA / reserveB
        setDepositA(formatDepositAmount((amountB * reserveA) / reserveB, tokenADecimals));
    }

    function OnSettingsSlippageAutoButtonClick()
    {
        setSlippageToAuto();
    }

    function setSlippageToAuto()
    {
        setInputSlippage("");
        setSlippage(0);
        setIsSlippageAuto(true);
        setIsSlippageHigh(false);
        setIsSlippageVeryHigh(false);
    }

    function OnSlippageSwapSettingsInputChange(value: string)
    {
        let newValue = 0;

        if(!value || value.trim().length == 0)
        {
            setSlippageToAuto();
            return;
        }

        newValue = parseFloat(value);
        newValue = parseFloat(newValue.toFixed(2));

        if(isNaN(newValue) || newValue < 0)
        {
            setSlippageToAuto();
            return;
        }

        if(newValue > 100)
        {
            setInputSlippage("100");
            setSlippage(100);
            setIsSlippageAuto(false);
            setIsSlippageHigh(false);
            setIsSlippageVeryHigh(true);
            return;
        }

        // Mesmos limiares do SwapForm: aviso e critico
        if(newValue > 5 && newValue < 20)
        {
            setIsSlippageHigh(true);
            setIsSlippageVeryHigh(false);
        }
        else if(newValue >= 20)
        {
            setIsSlippageHigh(false);
            setIsSlippageVeryHigh(true);
        }
        else
        {
            setIsSlippageHigh(false);
            setIsSlippageVeryHigh(false);
        }

        setSlippage(newValue);

        if(newValue == 0)
        {
            setSlippageToAuto();
            return;
        }

        setIsSlippageAuto(false);

        if(/^-?\d*\.?\d*$/.test(value))
        {
            setInputSlippage(value);
        }
    }

    // Aprova so quando falta allowance: nativo nao tem approve
    async function approveIfNeeded(token: Token, amountWei: bigint)
    {
        if(token.isNative || !ammCfg || !walletAddress)
        {
            return;
        }

        const tokenAddress = getAddress(token.address);
        const spender = getAddress(ammCfg.router);
        const allowance = await getAllowance(chainId, getAddress(walletAddress), spender, tokenAddress);

        if(allowance >= amountWei)
        {
            return;
        }

        OnNotification("Approving " + token.symbol + "...", "info", 60000);
        await callContractWrite(chainId, getTokenApproveFunction(tokenAddress, spender, maxUint256));
        OnNotification(token.symbol + " approved.", "success", 3000);
    }

    function OnCreatePoolButtonClick()
    {
        if(!onCreatePool)
        {
            return;
        }

        onCreatePool(tokenA, tokenB);
    }

    async function OnAddLiquidityClick()
    {
        if(!ammCfg || pool == null || isTxPending || !walletAddress || isSameToken)
        {
            return;
        }

        if(depositAWei == null || depositBWei == null || depositAWei <= 0n || depositBWei <= 0n)
        {
            OnNotification("Enter deposit amounts for both tokens.", "error", 4000);
            return;
        }

        setIsTxPending(true);
        setTxError(null);

        try
        {
            // Auto (0) nao pode virar tolerancia zero: usa um piso minimo
            const slippageTolerance = slippage > 0 ? slippage : DEFAULT_SLIPPAGE_AUTO;
            const toleranceBps = BigInt(Math.round(slippageTolerance * 100));

            // Piso de cada lado a partir do deposito: amount * (1 - tolerance)
            const amountAMin = (depositAWei * (10000n - toleranceBps)) / 10000n;
            const amountBMin = (depositBWei * (10000n - toleranceBps)) / 10000n;

            // ERC-20 paga via transferFrom: allowance antes do mint
            await approveIfNeeded(tokenA, depositAWei);
            await approveIfNeeded(tokenB, depositBWei);

            const recipient = getAddress(walletAddress);
            const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_MINUTES * 60);
            const router = getAddress(ammCfg.router);

            let addCall: ContractWriteCall;

            if(tokenA.isNative || tokenB.isNative)
            {
                // O Router so aceita 1 lado nativo: o outro vai como token ERC-20
                const isNativeA = tokenA.isNative == true;
                const erc20Token = isNativeA ? tokenB : tokenA;
                const amountTokenDesired = isNativeA ? depositBWei : depositAWei;
                const amountTokenMin = isNativeA ? amountBMin : amountAMin;
                const amountNativeMin = isNativeA ? amountAMin : amountBMin;

                addCall = {
                    address: router,
                    abi: routerAbi,
                    functionName: "addLiquidityNative",
                    args: [ getAddress(erc20Token.address), amountTokenDesired, amountTokenMin, amountNativeMin, recipient, deadline ],
                    value: isNativeA ? depositAWei : depositBWei,
                };
            }
            else
            {
                addCall = {
                    address: router,
                    abi: routerAbi,
                    functionName: "addLiquidity",
                    args: [ getAddress(tokenA.address), getAddress(tokenB.address), depositAWei, depositBWei, amountAMin, amountBMin, recipient, deadline ],
                };
            }

            await callContractWrite(chainId, addCall);

            OnNotification("Liquidity added to " + tokenA.symbol + "/" + tokenB.symbol + ".", "success", 4000);

            setDepositA("");
            setDepositB("");
            setRefreshKey((key) => key + 1);

            // Avisa o pai: My Positions precisa recarregar a lista
            onAddLiquiditySuccess?.();

            // O card de sucesso vive aqui: fecha depois que o usuario consegue ler
            closeTimerRef.current = window.setTimeout(() => { onClose(); }, 1500);
        }
        catch(error)
        {
            setTxError(getFriendlyErrorMessage(error));
        }
        finally
        {
            setIsTxPending(false);
        }
    }

    return (
        // O pai (overlay) nao fecha no clique: o formulario tem estado em andamento
        <div className="swap-modal-overlay fixed pt-45 inset-0 z-50 overflow-y-auto h-full w-full flex items-start justify-center">
            {/* O filho (conteudo) impede que o clique se propague para o pai */}
            <div
                className="swap-modal-area p-4 border w-[440px] max-w-[calc(100vw-2rem)] shadow-lg rounded-3xl"
                onClick={(event) => event.stopPropagation()}
            >
                {/* Header */}
                <div className="relative flex items-center min-h-[40px] mb-3">
                    <button
                        onClick={onClose}
                        className="swap-modal-close-button absolute right-0 top-1/2 -translate-y-1/2 px-2 py-2 text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 transition-colors"
                    >
                        <XIcon />
                    </button>

                    <div className="flex items-center gap-2">
                        <h3 className="swap-modal-title text-base font-bold">Add Liquidity</h3>

                        <button
                            className="swap-header-button flex justify-between items-center gap-1"
                            onClick={() => setIsSettingsOpen(true)}
                            aria-label="Slippage settings"
                        >
                            {isSlippageHigh && <TriangleAlert className="swap-slippage-warning-value w-4 h-4" />}
                            {isSlippageVeryHigh && <TriangleAlert className="swap-slippage-critical-value w-4 h-4" />}

                            {slippage > 0 && (
                                <span className={"swap-slippage-percent-value text-sm " + (isSlippageHigh ? "swap-slippage-warning-value" : (isSlippageVeryHigh ? "swap-slippage-critical-value" : ""))}>
                                    {slippage}%
                                </span>
                            )}

                            <Settings className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Token Pair */}
                <div className="pool-section p-3 rounded-2xl border mb-3">
                    <label className="pool-section-label text-xs block mb-2">Token Pair</label>

                    <div className="flex items-center gap-2">
                        <button
                            className="pool-token-button flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border"
                            onClick={() => { OnTokenSelectAButtonClick() }}
                        >
                            <Image src={tokenA.logoURI} alt={tokenA.name} width={24} height={24} className="rounded-full" />
                            <span className="text-base font-semibold">{tokenA.symbol}</span>
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                        </button>

                        <PlusIcon className="w-4 h-4 text-gray-500 shrink-0" />

                        <button
                            className="pool-token-button flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border"
                            onClick={() => { OnTokenSelectBButtonClick() }}
                        >
                            <Image src={tokenB.logoURI} alt={tokenB.name} width={24} height={24} className="rounded-full" />
                            <span className="text-base font-semibold">{tokenB.symbol}</span>
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                        </button>
                    </div>

                    {isSameToken && (
                        <div className="pool-note p-2 rounded-xl border mt-2 text-xs">
                            Select two different tokens to provide liquidity.
                        </div>
                    )}
                </div>

                {/* Carteira: o botao se esconde sozinho quando conectado */}
                <ConnectWalletButton variant="swap" />

                {isUnsupportedNetwork && (
                    <div className="pool-note p-3 rounded-xl border mt-1 text-xs">
                        This network is not configured for the Omnikron AMM.
                    </div>
                )}

                {!isUnsupportedNetwork && !isSameToken && isPairChecking && (
                    <div className="pool-section-label text-xs text-center mt-2">Checking pool...</div>
                )}

                {!isUnsupportedNetwork && !isSameToken && !isPairChecking && pool == null && (
                    <div>
                        <div className="pool-note p-3 rounded-xl border mt-1 text-xs">
                            No {tokenA.symbol}/{tokenB.symbol} pool with liquidity was found on this network.
                        </div>

                        {onCreatePool && (
                            <button
                                onClick={() => { OnCreatePoolButtonClick() }}
                                className="swap-action-button w-full mt-3 transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"
                            >
                                <PlusIcon className="w-4 h-4" />
                                Create Pool
                            </button>
                        )}
                    </div>
                )}

                {!isUnsupportedNetwork && !isSameToken && pool != null && (
                    <>
                        <div className="pool-fee-row flex items-center justify-between p-3 rounded-2xl border mb-3">
                            <div className="flex items-baseline gap-2">
                                <label className="pool-section-label text-xs">Pool Fee</label>
                                <span className="pool-fee-hint text-[10px] uppercase tracking-wide">from contract</span>
                            </div>

                            <span className="pool-fee-badge px-2 py-0.5 rounded-lg border text-sm font-semibold">
                                {(pool.feeBps / 100).toFixed(2)}%
                            </span>
                        </div>

                        <div className="flex flex-col gap-1">
                            <div className="swap-input-panel p-4 rounded-2xl border border-transparent transition-all">
                                <label className="swap-label text-xs block mb-1">{tokenA.symbol} deposit</label>

                                <div className="flex items-center justify-between">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0"
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-label={"Amount of " + tokenA.symbol + " to deposit"}
                                        value={depositA}
                                        onChange={(event) => { OnDepositAChange(event.target.value) }}
                                        className="swap-input bg-transparent text-3xl w-full focus:outline-none font-medium pr-2"
                                    />
                                    <span className="text-base font-semibold shrink-0">{tokenA.symbol}</span>
                                </div>

                                <div className="swap-token-balance text-xs mt-2 text-right">
                                    Balance: {tokenABalance != null && tokenADecimals ? formatEth(tokenABalance, tokenADecimals) : "0.00"}
                                </div>
                            </div>

                            <div className="relative h-0 flex items-center justify-center z-10">
                                <div className="swap-button-arrow border-4 p-2 rounded-xl">
                                    <PlusIcon className="w-4 h-4" />
                                </div>
                            </div>

                            <div className="swap-input-panel p-4 rounded-2xl border border-transparent transition-all">
                                <label className="swap-label text-xs block mb-1">{tokenB.symbol} deposit</label>

                                <div className="flex items-center justify-between">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0"
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-label={"Amount of " + tokenB.symbol + " to deposit"}
                                        value={depositB}
                                        onChange={(event) => { OnDepositBChange(event.target.value) }}
                                        className="swap-input bg-transparent text-3xl w-full focus:outline-none font-medium pr-2"
                                    />
                                    <span className="text-base font-semibold shrink-0">{tokenB.symbol}</span>
                                </div>

                                <div className="swap-token-balance text-xs mt-2 text-right">
                                    Balance: {tokenBBalance != null && tokenBDecimals ? formatEth(tokenBBalance, tokenBDecimals) : "0.00"}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between mt-3 px-1">
                            <span className="swap-label text-xs">Your share of pool</span>
                            <span className="text-xs font-semibold">{poolShare ?? "—"}</span>
                        </div>

                        {isConnected && (
                            <button
                                onClick={() => { OnAddLiquidityClick() }}
                                disabled={isAddDisabled}
                                className={(isAddDisabled ? "swap-action-button-disabled" : "swap-action-button") + " w-full mt-3 transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"}
                            >
                                {isTxPending ? "Adding liquidity..." : (addMessage ?? "Add Liquidity")}
                            </button>
                        )}

                        {txError && (
                            <div className="swap-tx-error text-xs mt-2 text-center">{txError}</div>
                        )}
                    </>
                )}
            </div>

            {isSettingsOpen && (
                <SwapSettings
                    onClose={() => setIsSettingsOpen(false)}
                    OnSlippageSwapSettingsInputChange={OnSlippageSwapSettingsInputChange}
                    OnSettingsSlippageAutoButtonClick={OnSettingsSlippageAutoButtonClick}
                    inputSlippage={inputSlippage}
                    isSlippageAuto={isSlippageAuto}
                    isSlippageHigh={isSlippageHigh}
                    isSlippageVeryHigh={isSlippageVeryHigh}
                />
            )}

            {isTokenSelectOpen && (
                <SwapTokenSelect
                    onClose={() => setIsTokenSelectOpen(false)}
                    isTokenSelectFrom={tokenSelectSide == "a"}
                    chainId={chainId}
                    walletAddress={walletAddress}
                    OnTokenSelectChainIdChanged={OnTokenSelectChainIdChanged}
                    OnTokenSelected={OnTokenSelected}
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

export default AddLiquidity;
