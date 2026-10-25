"use client"

import { ArrowRight, Settings, TriangleAlert, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAddress, maxUint256, type Address } from "viem";
import { useConnection } from "wagmi";
import ConnectWalletButton from "./ConnectWalletButton";
import NotificationCard, { NotificationCardProps } from "./NotificationCard";
import SwapSettings from "./SwapSettings";
import { getChainConfig } from "@/config/chainConfig";
import { erc20Abi } from "@/lib/abi/erc20";
import { pairAbi } from "@/lib/abi/pair";
import { routerAbi } from "@/lib/abi/router";
import { callContractRead, getAllowance, getFriendlyErrorMessage } from "@/lib/evm";
import { UserPool } from "@/lib/pools";
import { callContractWrite, ContractWriteCall, getTokenApproveFunction } from "@/lib/tx";
import { formatEth, isValidAmountInput } from "@/lib/utils";

interface RemoveLiquidityProps
{
    chainId: number;
    pool: UserPool;
    onClose(): void;
    onRemoveLiquiditySuccess?(): void;
}

// Snapshot da posicao lido on-chain: o UserPool da lista pode estar desatualizado
interface PositionState
{
    token0: Address;
    token1: Address;
    reserve0: bigint;
    reserve1: bigint;
    totalSupply: bigint;
    lpDecimals: number;
    userLiquidity: bigint;
    allowance: bigint;
    feeBps: number;
}

// Piso de slippage quando o usuario deixa em "Auto" (mesmo default do SwapForm/AddLiquidity)
const DEFAULT_SLIPPAGE_AUTO = 1.5;

// Fallback do fee quando o par nao expoe SWAP_FEE_BPS
const DEFAULT_POOL_FEE_BPS = 30;

const DEADLINE_MINUTES = 20;

// Atalhos de percentual do modal (10/20/75/Max, como na referencia)
const PERCENT_PRESETS = [ 10, 20, 75, 100 ];

function shortAddress(address: string): string
{
    return address.slice(0, 6) + "..." + address.slice(-4);
}

// Mostra o valor sem a cauda de zeros que o formatUnits produz
function formatAmount(value: bigint, decimals: number, maxFractionDigits = 6): string
{
    if(value <= 0n)
    {
        return "0";
    }

    const text = formatEth(value, decimals);

    if(!text.includes("."))
    {
        return text;
    }

    const [ whole, fraction ] = text.split(".");
    const trimmedFraction = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");

    return trimmedFraction.length > 0 ? whole + "." + trimmedFraction : whole;
}

// Participacao no pool em % com 2 casas, so com inteiros: (liquidity * 1_000_000) / totalSupply
function formatPoolShare(userLiquidity: bigint, totalSupply: bigint): string
{
    if(totalSupply <= 0n || userLiquidity <= 0n)
    {
        return "0.00%";
    }

    const scaled = (userLiquidity * 1000000n) / totalSupply;
    const whole = scaled / 10000n;
    const fraction = (scaled % 10000n).toString().padStart(4, "0").slice(0, 2);

    return whole.toString() + "." + fraction + "%";
}

// Preco relativo: quanto vale 1 unidade do numerador na moeda do denominador
function formatRatio(numerator: bigint, numeratorDecimals: number, denominator: bigint, denominatorDecimals: number): string
{
    if(numerator <= 0n || denominator <= 0n)
    {
        return "—";
    }

    const scaled = (numerator * 1000000n * (10n ** BigInt(denominatorDecimals))) / (denominator * (10n ** BigInt(numeratorDecimals)));
    const whole = scaled / 1000000n;
    const fraction = (scaled % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");

    return fraction.length > 0 ? whole + "." + fraction : whole.toString();
}

// LP tokens seguem o padrao de 18 casas; le de forma defensiva para nao quebrar em par customizado
async function readPairDecimals(chainId: number, pair: Address): Promise<number>
{
    try
    {
        const decimals = await callContractRead(chainId, pair, erc20Abi, "decimals", []) as number;

        return Number(decimals);
    }
    catch
    {
        return 18;
    }
}

// O fee e constante no Pair: mesma leitura defensiva do AddLiquidity
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

function RemoveLiquidity({chainId, pool, onClose, onRemoveLiquiditySuccess}: RemoveLiquidityProps)
{
    const { address: walletAddress, isConnected } = useConnection();

    const ammCfg = useMemo(() => getChainConfig(chainId), [chainId]);
    const isUnsupportedNetwork = !ammCfg;

    // Par somente leitura: vem da lista de posicoes (My Positions)
    const tokenA = pool.token0;
    const tokenB = pool.token1;
    const pairAddress = getAddress(pool.pair);

    const [notification, setNotification] = useState<NotificationCardProps | null>(null);

    const [positionState, setPositionState] = useState<PositionState | null>(null);
    const [positionError, setPositionError] = useState<string | null>(null);

    // Percentual digitado/arrastado: texto e a fonte da verdade (mantem "12." enquanto digita)
    const [percentText, setPercentText] = useState("");

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [slippage, setSlippage] = useState(0);
    const [inputSlippage, setInputSlippage] = useState("");
    const [isSlippageAuto, setIsSlippageAuto] = useState(true);
    const [isSlippageHigh, setIsSlippageHigh] = useState(false);
    const [isSlippageVeryHigh, setIsSlippageVeryHigh] = useState(false);

    const [isApproving, setIsApproving] = useState(false);
    const [isTxPending, setIsTxPending] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);

    // Incrementado apos approve/remove para reler saldo, reservas e allowance
    const [refreshKey, setRefreshKey] = useState(0);

    // O card de sucesso vive dentro deste modal: da um tempo antes de fechar
    const closeTimerRef = useRef<number | null>(null);

    // Sem carteira a posicao nao vale para a UI (evita mostrar dados de outra conta)
    const position = walletAddress ? positionState : null;

    // As reservas seguem a ordem do par, que nao e necessariamente (A, B)
    const isTokenAFirst = position != null && position.token0.toLowerCase() == tokenA.address.toLowerCase();
    const reserveForA = position == null ? pool.reserve0 : (isTokenAFirst ? position.reserve0 : position.reserve1);
    const reserveForB = position == null ? pool.reserve1 : (isTokenAFirst ? position.reserve1 : position.reserve0);

    const lpDecimals = position?.lpDecimals ?? 18;
    const userLiquidity = position?.userLiquidity ?? pool.userLiquidity;
    const totalSupply = position?.totalSupply ?? 0n;
    const feeBps = position?.feeBps ?? DEFAULT_POOL_FEE_BPS;

    // Percentual com 2 casas (33.33%) para o calculo, limitado a 100%
    const percentValue = Math.min(100, Math.max(0, parseFloat(percentText) || 0));
    const percentBps = BigInt(Math.round(percentValue * 100));

    const liquidityToRemove = (userLiquidity * percentBps) / 10000n;

    // Auto (0) nao pode virar tolerancia zero: usa um piso minimo
    const slippageTolerance = slippage > 0 ? slippage : DEFAULT_SLIPPAGE_AUTO;
    const toleranceBps = BigInt(Math.round(slippageTolerance * 100));

    // Retirada proporcional: amount = reserve * liquidity / totalSupply
    const expectedAmountA = totalSupply > 0n ? (reserveForA * liquidityToRemove) / totalSupply : 0n;
    const expectedAmountB = totalSupply > 0n ? (reserveForB * liquidityToRemove) / totalSupply : 0n;

    // Piso de cada lado: amount * (1 - tolerance)
    const amountAMin = (expectedAmountA * (10000n - toleranceBps)) / 10000n;
    const amountBMin = (expectedAmountB * (10000n - toleranceBps)) / 10000n;

    // Posicao atual (o que a wallet tem no pool) e saldo depois da retirada
    const currentAmountA = totalSupply > 0n ? (reserveForA * userLiquidity) / totalSupply : 0n;
    const currentAmountB = totalSupply > 0n ? (reserveForB * userLiquidity) / totalSupply : 0n;
    const newAmountA = currentAmountA > expectedAmountA ? currentAmountA - expectedAmountA : 0n;
    const newAmountB = currentAmountB > expectedAmountB ? currentAmountB - expectedAmountB : 0n;
    const nextLiquidity = userLiquidity > liquidityToRemove ? userLiquidity - liquidityToRemove : 0n;

    // O Router queima o LP com transferFrom: precisa de allowance para o router
    const needsApproval = position != null && liquidityToRemove > 0n && position.allowance < liquidityToRemove;

    // Rotulo/estado do botao, derivado no render (sem estado extra)
    let primaryLabel = "Remove Liquidity";
    let isPrimaryDisabled = false;

    if(isUnsupportedNetwork)
    {
        primaryLabel = "Unsupported network";
        isPrimaryDisabled = true;
    }
    else if(positionError != null)
    {
        primaryLabel = "Position unavailable";
        isPrimaryDisabled = true;
    }
    else if(position == null)
    {
        primaryLabel = "Loading position...";
        isPrimaryDisabled = true;
    }
    else if(userLiquidity <= 0n)
    {
        primaryLabel = "No liquidity to remove";
        isPrimaryDisabled = true;
    }
    else if(liquidityToRemove <= 0n)
    {
        primaryLabel = "Enter an amount";
        isPrimaryDisabled = true;
    }
    else if(isApproving)
    {
        primaryLabel = "Enabling LP tokens...";
        isPrimaryDisabled = true;
    }
    else if(isTxPending)
    {
        primaryLabel = "Removing liquidity...";
        isPrimaryDisabled = true;
    }
    else if(needsApproval)
    {
        primaryLabel = "Enable LP Tokens";
    }

    // Uma unica leitura alimenta reservas, supply, saldo de LP, allowance e fee
    useEffect(() =>
    {
        let isCancelled = false;

        async function readPosition()
        {
            if(!ammCfg || !walletAddress)
            {
                return;
            }

            try
            {
                const owner = getAddress(walletAddress);
                const spender = getAddress(ammCfg.router);

                const [ totalSupplyValue, reserves, token0, token1, userLiquidityValue, lpDecimalsValue, allowanceValue, feeBpsValue ] = await Promise.all([
                    callContractRead(chainId, pairAddress, pairAbi, "totalSupply", []) as Promise<bigint>,
                    callContractRead(chainId, pairAddress, pairAbi, "getReserves", []) as Promise<readonly [bigint, bigint, number]>,
                    callContractRead(chainId, pairAddress, pairAbi, "token0", []) as Promise<Address>,
                    callContractRead(chainId, pairAddress, pairAbi, "token1", []) as Promise<Address>,
                    callContractRead(chainId, pairAddress, pairAbi, "balanceOf", [ owner ]) as Promise<bigint>,
                    readPairDecimals(chainId, pairAddress),
                    getAllowance(chainId, owner, spender, pairAddress),
                    readPairFeeBps(chainId, pairAddress),
                ]);

                if(isCancelled)
                {
                    return;
                }

                setPositionState({
                    token0: getAddress(token0),
                    token1: getAddress(token1),
                    reserve0: reserves[0],
                    reserve1: reserves[1],
                    totalSupply: totalSupplyValue,
                    lpDecimals: lpDecimalsValue,
                    userLiquidity: userLiquidityValue,
                    allowance: allowanceValue,
                    feeBps: feeBpsValue,
                });
                setPositionError(null);
            }
            catch
            {
                if(!isCancelled)
                {
                    setPositionState(null);
                    setPositionError("Failed to load this position.");
                }
            }
        }

        readPosition();

        // Cleanup: descarta a resposta de um par/carteira que ja nao e o atual
        return () => { isCancelled = true; };
    }, [chainId, ammCfg, pairAddress, walletAddress, refreshKey]);

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

    function OnPercentChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        const parsed = parseFloat(value);

        // Limite duro: acima de 100% nao existe saldo para retirar
        if(!isNaN(parsed) && parsed > 100)
        {
            setPercentText("100");
            setTxError(null);
            return;
        }

        setPercentText(value);
        setTxError(null);
    }

    function OnPercentPresetClick(value: number)
    {
        setPercentText(value.toString());
        setTxError(null);
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

    // Passo 1 do fluxo: o LP e um ERC-20 do par, entao o approve vai para o Router
    async function OnEnableLiquidityClick()
    {
        if(!ammCfg || !walletAddress || isApproving || isTxPending)
        {
            return;
        }

        setIsApproving(true);
        setTxError(null);

        try
        {
            const spender = getAddress(ammCfg.router);

            OnNotification("Enabling LP tokens...", "info", 60000);
            await callContractWrite(chainId, getTokenApproveFunction(pairAddress, spender, maxUint256));
            OnNotification("LP tokens enabled.", "success", 3000);

            // Relê a allowance: o botao vira "Remove Liquidity"
            setRefreshKey((key) => key + 1);
        }
        catch(error)
        {
            setTxError(getFriendlyErrorMessage(error));
        }
        finally
        {
            setIsApproving(false);
        }
    }

    // Passo 2 do fluxo: queima o LP e recebe os dois lados (nativo via removeLiquidityNative)
    async function OnRemoveLiquidityClick()
    {
        if(!ammCfg || position == null || isTxPending || isApproving || !walletAddress)
        {
            return;
        }

        if(liquidityToRemove <= 0n)
        {
            OnNotification("Select how much liquidity to remove.", "error", 4000);
            return;
        }

        if(position.allowance < liquidityToRemove)
        {
            OnNotification("Enable the LP tokens before removing liquidity.", "error", 4000);
            return;
        }

        setIsTxPending(true);
        setTxError(null);

        try
        {
            const recipient = getAddress(walletAddress);
            const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_MINUTES * 60);
            const router = getAddress(ammCfg.router);

            const isNativeA = tokenA.isNative == true;
            const isNativeB = tokenB.isNative == true;

            let removeCall: ContractWriteCall;

            if(isNativeA || isNativeB)
            {
                // O Router so aceita 1 lado nativo: o outro vai como token ERC-20
                const erc20Token = isNativeA ? tokenB : tokenA;
                const amountTokenMin = isNativeA ? amountBMin : amountAMin;
                const amountNativeMin = isNativeA ? amountAMin : amountBMin;

                removeCall = {
                    address: router,
                    abi: routerAbi,
                    functionName: "removeLiquidityNative",
                    args: [ getAddress(erc20Token.address), liquidityToRemove, amountTokenMin, amountNativeMin, recipient, deadline ],
                };
            }
            else
            {
                removeCall = {
                    address: router,
                    abi: routerAbi,
                    functionName: "removeLiquidity",
                    args: [ getAddress(tokenA.address), getAddress(tokenB.address), liquidityToRemove, amountAMin, amountBMin, recipient, deadline ],
                };
            }

            await callContractWrite(chainId, removeCall);

            OnNotification("Liquidity removed from " + tokenA.symbol + "/" + tokenB.symbol + ".", "success", 4000);

            setPercentText("");
            setRefreshKey((key) => key + 1);

            // Avisa o pai: My Positions precisa recarregar a lista
            onRemoveLiquiditySuccess?.();

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

    function OnPrimaryButtonClick()
    {
        if(needsApproval)
        {
            OnEnableLiquidityClick();
            return;
        }

        OnRemoveLiquidityClick();
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
                        <h3 className="swap-modal-title text-base font-bold">Remove Liquidity</h3>

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

                {/* Par de tokens: somente leitura */}
                <div className="pool-section p-3 rounded-2xl border mb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center">
                                <Image src={tokenA.logoURI} alt={tokenA.name} width={26} height={26} className="swap-modal-row-icon rounded-full" />
                                <Image src={tokenB.logoURI} alt={tokenB.name} width={26} height={26} className="swap-modal-row-icon rounded-full -ml-2" />
                            </div>

                            <div>
                                <div className="swap-modal-row-name text-sm font-bold">{tokenA.symbol} / {tokenB.symbol}</div>
                                <div className="pool-fee-hint text-[10px]">LP {shortAddress(pairAddress)}</div>
                            </div>
                        </div>

                        <span className="pool-fee-badge px-2 py-1 rounded-full text-xs font-semibold">
                            {(feeBps / 100).toFixed(2)}%
                        </span>
                    </div>
                </div>

                {/* Carteira: o botao se esconde sozinho quando conectado */}
                <ConnectWalletButton variant="swap" />

                {isUnsupportedNetwork && (
                    <div className="pool-note p-3 rounded-xl border text-xs">
                        This network is not configured for the Omnikron AMM.
                    </div>
                )}

                {!isUnsupportedNetwork && positionError != null && (
                    <div className="pool-note p-3 rounded-xl border text-xs">{positionError}</div>
                )}

                {!isUnsupportedNetwork && positionError == null && isConnected && (
                    <>
                        {/* Percentual a retirar */}
                        <div className="swap-input-panel p-4 rounded-2xl border border-transparent transition-all mb-3">
                            <div className="flex items-center justify-between">
                                <label className="swap-label text-xs">Amount of liquidity to remove</label>
                                <span className="swap-token-balance text-xs">LP: {formatAmount(userLiquidity, lpDecimals, 8)}</span>
                            </div>

                            <div className="flex items-baseline gap-1 mt-1">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0"
                                    autoComplete="off"
                                    spellCheck={false}
                                    aria-label="Percentage of liquidity to remove"
                                    value={percentText}
                                    onChange={(event) => { OnPercentChange(event.target.value) }}
                                    className="swap-input bg-transparent text-4xl w-full focus:outline-none font-semibold"
                                />
                                <span className="text-2xl font-semibold shrink-0">%</span>
                            </div>

                            <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={Math.round(percentValue)}
                                onChange={(event) => { OnPercentChange(event.target.value) }}
                                aria-label="Liquidity percentage slider"
                                className="pool-range mt-3"
                            />

                            <div className="flex gap-2 mt-3">
                                {PERCENT_PRESETS.map((value) => (
                                    <button
                                        key={value}
                                        onClick={() => { OnPercentPresetClick(value) }}
                                        className="swap-action-alt-button flex-1 px-2 py-2 rounded-xl text-sm font-semibold transition-colors"
                                    >
                                        {value == 100 ? "Max" : value + "%"}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Cotacao do par */}
                        <div className="pool-section p-3 rounded-2xl border mb-3">
                            <label className="pool-section-label text-xs block mb-2">Rates</label>

                            <div className="flex items-center justify-between text-xs">
                                <span className="swap-label">1 {tokenA.symbol}</span>
                                <span className="font-semibold">{formatRatio(reserveForB, tokenB.decimals, reserveForA, tokenA.decimals)} {tokenB.symbol}</span>
                            </div>

                            <div className="flex items-center justify-between text-xs mt-1">
                                <span className="swap-label">1 {tokenB.symbol}</span>
                                <span className="font-semibold">{formatRatio(reserveForA, tokenA.decimals, reserveForB, tokenB.decimals)} {tokenA.symbol}</span>
                            </div>
                        </div>

                        {/* Posicao atual -> depois da retirada */}
                        <div className="pool-section p-3 rounded-2xl border mb-3">
                            <div className="flex items-center justify-between mb-2">
                                <label className="pool-section-label text-xs">Position</label>
                                <span className="pool-fee-hint text-[10px] uppercase tracking-wide">Current → New</span>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Image src={tokenA.logoURI} alt={tokenA.name} width={20} height={20} className="swap-modal-row-icon rounded-full" />
                                    <span className="text-xs font-semibold">{tokenA.symbol}</span>
                                </div>

                                <div className="flex items-center gap-2 text-xs">
                                    <span className="swap-token-balance">{formatAmount(currentAmountA, tokenA.decimals)}</span>
                                    <ArrowRight className="pool-ratio-equals w-3 h-3" />
                                    <span className="font-semibold">{formatAmount(newAmountA, tokenA.decimals)}</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between mt-2">
                                <div className="flex items-center gap-2">
                                    <Image src={tokenB.logoURI} alt={tokenB.name} width={20} height={20} className="swap-modal-row-icon rounded-full" />
                                    <span className="text-xs font-semibold">{tokenB.symbol}</span>
                                </div>

                                <div className="flex items-center gap-2 text-xs">
                                    <span className="swap-token-balance">{formatAmount(currentAmountB, tokenB.decimals)}</span>
                                    <ArrowRight className="pool-ratio-equals w-3 h-3" />
                                    <span className="font-semibold">{formatAmount(newAmountB, tokenB.decimals)}</span>
                                </div>
                            </div>

                            <div className="swap-modal-divider h-px my-3" />

                            <div className="flex items-center justify-between text-xs">
                                <span className="swap-label">Your pool share</span>
                                <span className="font-semibold">
                                    {formatPoolShare(userLiquidity, totalSupply)} → {formatPoolShare(nextLiquidity, totalSupply)}
                                </span>
                            </div>

                            <div className="mt-2">
                                <span className="swap-label text-xs">You will receive</span>
                                <div className="text-xs font-semibold mt-1">{formatAmount(expectedAmountA, tokenA.decimals)} {tokenA.symbol}</div>
                                <div className="text-xs font-semibold">{formatAmount(expectedAmountB, tokenB.decimals)} {tokenB.symbol}</div>

                                <div className="swap-token-balance text-[10px] mt-1">
                                    Min. {formatAmount(amountAMin, tokenA.decimals)} {tokenA.symbol} / {formatAmount(amountBMin, tokenB.decimals)} {tokenB.symbol} ({slippageTolerance}% slippage)
                                </div>
                            </div>
                        </div>

                        {needsApproval && (
                            <div className="pool-note p-3 rounded-xl border text-xs mb-3">
                                Enable the LP tokens once so the router can burn them.
                            </div>
                        )}

                        <button
                            onClick={() => { OnPrimaryButtonClick() }}
                            disabled={isPrimaryDisabled}
                            className={(isPrimaryDisabled ? "swap-action-button-disabled" : "swap-action-button") + " w-full transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"}
                        >
                            {primaryLabel}
                        </button>

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

export default RemoveLiquidity;
