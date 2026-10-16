"use client"

import { ChevronDown, PlusIcon, Settings, TriangleAlert, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
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
import { findNetwork, getNetworkList } from "@/lib/networks";
import { findToken, getFirstNonNativeToken, getNativeToken, getTokenList, Token } from "@/lib/tokens";
import { callContractWrite, ContractWriteCall, getTokenApproveFunction } from "@/lib/tx";
import { formatEth, isValidAmountInput, toAmountBigInt } from "@/lib/utils";

interface CreatePoolWindowProps
{
    chainId: number;
    changeChainId(value: number): void;
    onClose(): void;
}

// Piso de slippage quando o usuario deixa em "Auto" (mesmo default do SwapForm)
const DEFAULT_SLIPPAGE_AUTO = 1.5;

// Fallback do fee quando a rede ainda nao tem nenhum par para ler o SWAP_FEE_BPS
const DEFAULT_POOL_FEE_BPS = 30;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// findNetwork devolve logoURI vazio em rede desconhecida: evita src invalido no next/image
function resolveNetworkLogo(logoURI: string): string
{
    return logoURI && logoURI.length > 0 ? logoURI : "/network/generic.svg";
}

function CreatePoolWindow({chainId, changeChainId, onClose}: CreatePoolWindowProps)
{
    const { address: walletAddress, isConnected } = useConnection();

    const [notification, setNotification] = useState<NotificationCardProps | null>(null);

    const chain = findSupportedChain(chainId);
    const ammCfg = useMemo(() => getChainConfig(chainId), [chainId]);
    const isUnsupportedNetwork = !chain || getTokenList(chainId).length === 0;

    // Par de tokens: A e o primeiro lado (ex.: OMNIKRON), B e o segundo (ex.: BNB)
    const initialTokenA = getNativeToken(chainId);
    const initialTokenB = getFirstNonNativeToken(chainId);

    const [tokenA, setTokenA] = useState<Token>(initialTokenA);
    const [tokenB, setTokenB] = useState<Token>(initialTokenB);
    const [tokenADecimals, setTokenADecimals] = useState<number | undefined>(initialTokenA.decimals);
    const [tokenBDecimals, setTokenBDecimals] = useState<number | undefined>(initialTokenB.decimals);
    const [tokenABalance, setTokenABalance] = useState<bigint | undefined>(undefined);
    const [tokenBBalance, setTokenBBalance] = useState<bigint | undefined>(undefined);

    // Passo 1 (rede + par + fee) e passo 2 (preco inicial + deposito)
    const [isPriceStep, setIsPriceStep] = useState(false);

    // Start price: "priceA TOKEN_A = priceB TOKEN_B"
    const [priceA, setPriceA] = useState("1");
    const [priceB, setPriceB] = useState("");

    // Deposito: o lado editado e a fonte da verdade e define o outro pela razao
    const [depositA, setDepositA] = useState("");
    const [depositB, setDepositB] = useState("");
    const [depositSide, setDepositSide] = useState<"a" | "b" | null>(null);

    const [feeBps, setFeeBps] = useState<number | null>(null);
    const [poolExists, setPoolExists] = useState(false);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [slippage, setSlippage] = useState(0);
    const [inputSlippage, setInputSlippage] = useState("");
    const [isSlippageAuto, setIsSlippageAuto] = useState(true);
    const [isSlippageHigh, setIsSlippageHigh] = useState(false);
    const [isSlippageVeryHigh, setIsSlippageVeryHigh] = useState(false);

    const [isTokenSelectOpen, setIsTokenSelectOpen] = useState(false);
    const [tokenSelectSide, setTokenSelectSide] = useState<"a" | "b">("a");

    const [isNetworkSelectOpen, setIsNetworkSelectOpen] = useState(false);

    const [isTxPending, setIsTxPending] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);

    // Incrementado apos transacoes que mexem no saldo para forcar a releitura
    const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

    // Derivado no render: par (texto, wei) sempre coerente com os decimals do token
    const priceAWei = useMemo(() => toAmountBigInt(priceA, tokenADecimals), [priceA, tokenADecimals]);
    const priceBWei = useMemo(() => toAmountBigInt(priceB, tokenBDecimals), [priceB, tokenBDecimals]);
    const depositAWei = useMemo(() => toAmountBigInt(depositA, tokenADecimals), [depositA, tokenADecimals]);
    const depositBWei = useMemo(() => toAmountBigInt(depositB, tokenBDecimals), [depositB, tokenBDecimals]);

    const isSameToken = tokenA.address.toLowerCase() === tokenB.address.toLowerCase();
    const isPriceValid = priceAWei != null && priceAWei > 0n && priceBWei != null && priceBWei > 0n;
    const isDepositValid = depositAWei != null && depositAWei > 0n && depositBWei != null && depositBWei > 0n;

    // "1 TOKEN_A = x TOKEN_B" para exibir como confirmacao do Start Price
    const unitPriceB = useMemo(() =>
    {
        if(priceAWei == null || priceBWei == null || priceAWei <= 0n || priceBWei <= 0n || !tokenADecimals)
        {
            return null;
        }

        // 1 unidade de A em B: priceB_wei * 10^decA / priceA_wei (os decimals se cancelam)
        return formatEth((priceBWei * (10n ** BigInt(tokenADecimals))) / priceAWei, tokenBDecimals);
    }, [priceAWei, priceBWei, tokenADecimals, tokenBDecimals]);

    // Qualquer mudanca de rede recomeca o fluxo: novo par, novo preco, novos totalt
    useEffect(() =>
    {
        const nextTokenA = getNativeToken(chainId);
        const nextTokenB = getFirstNonNativeToken(chainId);

        setTokenA(nextTokenA);
        setTokenB(nextTokenB);
        setTokenADecimals(nextTokenA.decimals);
        setTokenBDecimals(nextTokenB.decimals);

        setIsPriceStep(false);
        setPriceA("1");
        setPriceB("");
        setDepositA("");
        setDepositB("");
        setDepositSide(null);
        setTxError(null);
    }, [chainId]);

    // Saldos e decimals de cada lado (nativo usa getBalance; ERC-20 usa balanceOf)
    useEffect(() =>
    {
        let isCancelled = false;

        async function readTokenBalance(targetChainId: number, token: Token)
        {
            if(!walletAddress)
            {
                return { balance: undefined, decimals: token.decimals };
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
                // Token inexistente na rede ou RPC fora: nao manter valor antigo na tela
                return { balance: undefined, decimals: token.decimals };
            }
        }

        async function syncBalances()
        {
            if(isUnsupportedNetwork)
            {
                setTokenABalance(undefined);
                setTokenBBalance(undefined);
                return;
            }

            const nextA = await readTokenBalance(chainId, tokenA);

            if(isCancelled) return;

            setTokenABalance(nextA.balance);
            setTokenADecimals(nextA.decimals);

            const nextB = await readTokenBalance(chainId, tokenB);

            if(isCancelled) return;

            setTokenBBalance(nextB.balance);
            setTokenBDecimals(nextB.decimals);
        }

        syncBalances();

        // Cleanup: descarta a resposta de uma rede/token que ja nao e o atual (evita corrida)
        return () => { isCancelled = true; };
    }, [chainId, walletAddress, isUnsupportedNetwork, tokenA.address, tokenB.address, balanceRefreshKey]);

    // Fee Level lido do contrato: SWAP_FEE_BPS() e constante no Pair.
    // Um par novo ainda nao existe, entao o valor e lido de um par ja publicado da rede
    // (todos os pares compartilham a mesma constante).
    useEffect(() =>
    {
        let isCancelled = false;

        async function readFeeBps()
        {
            if(!ammCfg)
            {
                setFeeBps(null);
                return;
            }

            try
            {
                const factory = getAddress(ammCfg.factory);
                const length = await callContractRead(chainId, factory, factoryAbi, "allPairsLength", []) as bigint;

                if(length <= 0n)
                {
                    // Nenhum par publicado ainda: vale o default do contrato (30 bps = 0.30%)
                    if(!isCancelled) setFeeBps(DEFAULT_POOL_FEE_BPS);
                    return;
                }

                const firstPair = await callContractRead(chainId, factory, factoryAbi, "allPairs", [ 0n ]) as Address;
                const bps = await callContractRead(chainId, firstPair, pairAbi, "SWAP_FEE_BPS", []) as bigint;

                if(!isCancelled) setFeeBps(Number(bps));
            }
            catch
            {
                // Leitura falhou: mantem o default do contrato para nao travar a UI
                if(!isCancelled) setFeeBps(DEFAULT_POOL_FEE_BPS);
            }
        }

        readFeeBps();

        return () => { isCancelled = true; };
    }, [chainId, ammCfg]);

    // O par ja existe? Se sim, o Start Price e ignorado pelo Router (reserva != 0)
    useEffect(() =>
    {
        let isCancelled = false;

        async function readPairExists()
        {
            setPoolExists(false);

            if(!ammCfg || isSameToken)
            {
                return;
            }

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

                if(!isCancelled) setPoolExists(pair != ZERO_ADDRESS);
            }
            catch
            {
                if(!isCancelled) setPoolExists(false);
            }
        }

        readPairExists();

        return () => { isCancelled = true; };
    }, [chainId, ammCfg, tokenA, tokenB, isSameToken]);

    // Auto-preenchimento do deposito: espelha a razao do Start Price no lado NAO editado.
    // Escreve sempre no lado oposto ao depositSide, entao nao existe loop.
    useEffect(() =>
    {
        if(!depositSide)
        {
            return;
        }

        if(priceAWei == null || priceBWei == null || priceAWei <= 0n || priceBWei <= 0n)
        {
            return;
        }

        if(depositSide == "a")
        {
            if(depositAWei == null || depositAWei <= 0n)
            {
                setDepositB("");
                return;
            }

            setDepositB(formatEth((depositAWei * priceBWei) / priceAWei, tokenBDecimals));
            return;
        }

        if(depositBWei == null || depositBWei <= 0n)
        {
            setDepositA("");
            return;
        }

        setDepositA(formatEth((depositBWei * priceAWei) / priceBWei, tokenADecimals));
    }, [depositSide, depositAWei, depositBWei, priceAWei, priceBWei, tokenADecimals, tokenBDecimals]);

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

    function OnNetworkSelected(value: number)
    {
        setIsNetworkSelectOpen(false);

        if(value == chainId)
        {
            return;
        }

        changeChainId(value);
    }

    function OnTokenSelectChainIdChanged(value: number)
    {
        if(value == chainId)
        {
            return;
        }

        changeChainId(value);
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

        // A razao anterior valia para o par anterior
        setDepositA("");
        setDepositB("");
        setDepositSide(null);
    }

    function OnPriceAChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        setPriceA(value);
    }

    function OnPriceBChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        setPriceB(value);
    }

    function OnDepositAChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        setDepositA(value);
        setDepositSide(value.trim().length > 0 ? "a" : null);

        if(value.trim().length == 0)
        {
            setDepositB("");
        }
    }

    function OnDepositBChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        setDepositB(value);
        setDepositSide(value.trim().length > 0 ? "b" : null);

        if(value.trim().length == 0)
        {
            setDepositA("");
        }
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

    async function OnCreatePoolClick()
    {
        if(!ammCfg || isTxPending || !walletAddress || isSameToken || !isPriceValid || !isDepositValid || depositAWei == null || depositBWei == null)
        {
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
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

            let createCall: ContractWriteCall;

            if(tokenA.isNative || tokenB.isNative)
            {
                // O Router so aceita 1 lado nativo: o outro vai como token ERC-20
                const isNativeA = tokenA.isNative == true;
                const erc20Token = isNativeA ? tokenB : tokenA;
                const amountTokenDesired = isNativeA ? depositBWei : depositAWei;
                const amountTokenMin = isNativeA ? amountBMin : amountAMin;
                const amountNativeMin = isNativeA ? amountAMin : amountBMin;

                createCall = {
                    address: ammCfg.router,
                    abi: routerAbi,
                    functionName: "addLiquidityNative",
                    args: [ getAddress(erc20Token.address), amountTokenDesired, amountTokenMin, amountNativeMin, recipient, deadline ],
                    value: isNativeA ? depositAWei : depositBWei,
                };
            }
            else
            {
                createCall = {
                    address: ammCfg.router,
                    abi: routerAbi,
                    functionName: "addLiquidity",
                    args: [
                        getAddress(tokenA.address),
                        getAddress(tokenB.address),
                        depositAWei,
                        depositBWei,
                        amountAMin,
                        amountBMin,
                        recipient,
                        deadline,
                    ],
                };
            }

            await callContractWrite(chainId, createCall);

            OnNotification(
                poolExists
                    ? "Liquidity added to " + tokenA.symbol + "/" + tokenB.symbol + "."
                    : "Pool " + tokenA.symbol + "/" + tokenB.symbol + " created.",
                "success",
                5000,
            );

            setDepositA("");
            setDepositB("");
            setDepositSide(null);
            setBalanceRefreshKey((key) => key + 1);
        }
        catch(error)
        {
            setTxError(getFriendlyErrorMessage(error));
            OnNotification(getFriendlyErrorMessage(error), "error", 10000);
        }
        finally
        {
            setIsTxPending(false);
        }
    }

    // Mensagem de estado derivada no render (sem estado extra)
    let createMessage: string | null = null;

    if(isUnsupportedNetwork)
    {
        createMessage = "Unsupported network";
    }
    else if(isSameToken)
    {
        createMessage = "Select two different tokens";
    }
    else if(!isPriceValid)
    {
        createMessage = "Enter a start price";
    }
    else if(!isDepositValid)
    {
        createMessage = "Enter deposit amounts";
    }
    else if(walletAddress && tokenABalance != null && depositAWei != null && depositAWei > tokenABalance)
    {
        createMessage = "Not enough " + tokenA.symbol;
    }
    else if(walletAddress && tokenBBalance != null && depositBWei != null && depositBWei > tokenBBalance)
    {
        createMessage = "Not enough " + tokenB.symbol;
    }

    const isCreateDisabled = createMessage != null || isTxPending;

    const canContinue = !isUnsupportedNetwork && !isSameToken;

    const network = findNetwork(chainId);

    return (
        // O pai (overlay) captura o clique e fecha a janela
        <div
            className="swap-modal-overlay fixed pt-45 inset-0 z-50 overflow-y-auto h-full w-full flex items-start justify-center"
            onClick={onClose}
        >
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
                        <h3 className="swap-modal-title text-base font-bold">Create Pool</h3>

                        <button
                            className="swap-header-button flex justify-between items-center gap-1"
                            onClick={() => setIsSettingsOpen(true)}
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

                {/* Stepper */}
                <div className="flex items-center gap-2 mb-4">
                    <span className={"pool-step-dot flex items-center justify-center w-6 h-6 rounded-full border text-xs font-semibold " + (isPriceStep ? "pool-step-dot-done" : "pool-step-dot-active")}>
                        1
                    </span>
                    <span className={"pool-step-label text-xs font-medium " + (isPriceStep ? "" : "pool-step-label-active")}>Pair</span>

                    <span className="pool-step-bar h-px flex-1" />

                    <span className={"pool-step-dot flex items-center justify-center w-6 h-6 rounded-full border text-xs font-semibold " + (isPriceStep ? "pool-step-dot-active" : "")}>
                        2
                    </span>
                    <span className={"pool-step-label text-xs font-medium " + (isPriceStep ? "pool-step-label-active" : "")}>Price</span>
                </div>

                {/* STEP 1: network + pair + fee */}
                {!isPriceStep && (
                    <div>
                        <div className="pool-section p-3 rounded-2xl border mb-3">
                            <label className="pool-section-label text-xs block mb-2">Network</label>

                            <button
                                className="pool-network-button w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border"
                                onClick={() => setIsNetworkSelectOpen(true)}
                            >
                                <span className="flex items-center gap-2">
                                    <Image
                                        src={resolveNetworkLogo(network.logoURI)}
                                        alt={network.name}
                                        width={20}
                                        height={20}
                                        className="rounded-full"
                                    />
                                    <span className="text-sm font-semibold">{network.name}</span>
                                </span>
                                <ChevronDown className="w-4 h-4 text-gray-400" />
                            </button>
                        </div>

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
                                    Select two different tokens to create a pair.
                                </div>
                            )}
                        </div>

                        <div className="pool-fee-row flex items-center justify-between p-3 rounded-2xl border mb-3">
                            <div className="flex items-baseline gap-2">
                                <label className="pool-section-label text-xs">Pool Fee</label>
                                <span className="pool-fee-hint text-[10px] uppercase tracking-wide">from contract</span>
                            </div>

                            <span className="pool-fee-badge px-2 py-0.5 rounded-lg border text-sm font-semibold">
                                {feeBps == null ? "..." : (feeBps / 100).toFixed(2) + "%"}
                            </span>
                        </div>

                        <button
                            onClick={() => setIsPriceStep(true)}
                            disabled={!canContinue}
                            className={(canContinue ? "swap-action-button" : "swap-action-button-disabled") + " w-full mt-1 transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"}
                        >
                            Continue
                        </button>
                    </div>
                )}

                {/* STEP 2: start price + deposits */}
                {isPriceStep && (
                    <div>
                        <div className="pool-section p-3 rounded-2xl border mb-3">
                            <div className="flex items-center justify-between mb-2">
                                <label className="pool-section-label text-xs">Start Price</label>

                                <button
                                    className="swap-feature-button text-xs rounded py-0.5 px-1.5 font-semibold"
                                    onClick={() => setIsPriceStep(false)}
                                >
                                    Change pair
                                </button>
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="pool-ratio-field flex-1 flex items-center border rounded-xl px-3 py-2">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0"
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-label={"Start price amount of " + tokenA.symbol}
                                        value={priceA}
                                        onChange={(event) => { OnPriceAChange(event.target.value) }}
                                        className="swap-input bg-transparent w-full focus:outline-none font-medium text-base"
                                    />
                                    <span className="pool-ratio-suffix pl-2 text-sm font-semibold shrink-0">{tokenA.symbol}</span>
                                </div>

                                <span className="pool-ratio-equals shrink-0">=</span>

                                <div className="pool-ratio-field flex-1 flex items-center border rounded-xl px-3 py-2">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0"
                                        autoComplete="off"
                                        spellCheck={false}
                                        aria-label={"Start price amount of " + tokenB.symbol}
                                        value={priceB}
                                        onChange={(event) => { OnPriceBChange(event.target.value) }}
                                        className="swap-input bg-transparent w-full focus:outline-none font-medium text-base"
                                    />
                                    <span className="pool-ratio-suffix pl-2 text-sm font-semibold shrink-0">{tokenB.symbol}</span>
                                </div>
                            </div>

                            {unitPriceB != null && (
                                <div className="pool-ratio-hint text-xs mt-2 text-right">
                                    1 {tokenA.symbol} = {unitPriceB} {tokenB.symbol}
                                </div>
                            )}
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

                        {isPriceValid && isDepositValid && !poolExists && (
                            <div className="pool-note p-3 rounded-xl border mt-3 text-xs">
                                This first deposit sets the pool price at {unitPriceB} {tokenB.symbol} per {tokenA.symbol}.
                            </div>
                        )}

                        {poolExists && (
                            <div className="pool-note p-3 rounded-xl border mt-3 text-xs">
                                The {tokenA.symbol}/{tokenB.symbol} pool already exists. The Start Price is ignored &mdash; the deposit is added at the pool&apos;s current ratio.
                            </div>
                        )}

                        <ConnectWalletButton variant="swap" />

                        {isConnected && (
                            <button
                                onClick={() => { OnCreatePoolClick() }}
                                disabled={isCreateDisabled}
                                className={(isCreateDisabled ? "swap-action-button-disabled" : "swap-action-button") + " w-full mt-3 transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"}
                            >
                                {isTxPending ? "Creating pool..." : (createMessage ?? (poolExists ? "Add Liquidity" : "Create Pool & Add Liquidity"))}
                            </button>
                        )}

                        {txError && (
                            <div className="swap-tx-error text-xs mt-2 text-center">{txError}</div>
                        )}
                    </div>
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

            {isNetworkSelectOpen && (
                <div
                    className="swap-modal-overlay fixed pt-45 inset-0 z-50 overflow-y-auto h-full w-full flex items-start justify-center"
                    onClick={() => setIsNetworkSelectOpen(false)}
                >
                    <div
                        className="swap-modal-area p-4 border w-96 shadow-lg rounded-3xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="relative flex items-center min-h-[40px] mb-4">
                            <button
                                onClick={() => setIsNetworkSelectOpen(false)}
                                className="swap-modal-close-button absolute right-0 top-1/2 -translate-y-1/2 px-2 py-2 text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 transition-colors"
                            >
                                <XIcon />
                            </button>

                            <h3 className="swap-modal-title text-base font-bold">Select Network</h3>
                        </div>

                        <div className="swap-modal-divider h-px mb-2" />

                        <div className="swap-modal-list flex flex-col gap-1 max-h-[420px] overflow-y-auto">
                            {getNetworkList().map((item) => (
                                <div
                                    key={item.id}
                                    className={"swap-modal-row flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors" + (item.id == chainId ? " pool-network-row-selected" : "")}
                                    onClick={() => { OnNetworkSelected(item.id) }}
                                >
                                    <Image
                                        src={resolveNetworkLogo(item.logoURI)}
                                        alt={item.name}
                                        width={28}
                                        height={28}
                                        className="swap-modal-row-icon rounded-full"
                                    />

                                    <div className="flex flex-col">
                                        <span className="swap-modal-row-name text-sm font-semibold">{item.name}</span>
                                        <span className="swap-modal-row-symbol text-xs">{item.symbol}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
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

export default CreatePoolWindow
