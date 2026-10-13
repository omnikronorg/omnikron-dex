"use client"

import { ArrowDown, ArrowDownUp, ChevronDown, Settings, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import SwapSettings from "./SwapSettings";
import SwapTokenSelect from "./SwapTokenSelect";
import { findToken, getFirstNonNativeToken, getNativeToken, getTokenList, Token } from "@/lib/tokens";
import ConnectWalletButton from "./ConnectWalletButton";
import { findSupportedChain } from "@/lib/chains";
import { useBalance, useConnection, useReadContracts } from "wagmi";
import { clampAmountDecimals, formatEth, isParseableAmountInput, isValidAmountInput, toAmountBigInt } from "@/lib/utils";
import { getAllowance, getBalance, getFriendlyErrorMessage, getNativeTokenDecimals, getTokenBalance, getTokenDecimals } from "@/lib/evm";
import { getAddress, maxUint256 } from "viem";
import { AmmConfig, getBestQuote, getQuoteCalls, getRouteCandidates, INSUFFICIENT_LIQUIDITY_MESSAGE, isQuotableAmount, isQuoteWithinSlippage, QuoteSide } from "@/lib/amm";
import { getChainConfig } from "@/config/chainConfig";
import { callContractWrite, ContractWriteCall, getTokenApproveFunction } from "@/lib/tx";
import NotificationCard, { NotificationCardProps } from "./NotificationCard";
import { readContracts } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import { routerAbi } from "@/lib/abi/router";

interface SwapFormProps
{
    chainId: number;
    changeChainId(value: number): void;
    isTokenSelectOpen: boolean;
    setIsTokenSelectOpen(value: boolean): void;
    isTokenSelectFrom: boolean;
    setIsTokenSelectFrom(value: boolean): void;
}

function SwapForm({chainId, changeChainId, isTokenSelectOpen, setIsTokenSelectOpen, isTokenSelectFrom, setIsTokenSelectFrom}: SwapFormProps)
{
    const { address: walletAddress, isConnected } = useConnection();

    const [notification, setNotification] = useState<NotificationCardProps | null>(null);

    const chain = findSupportedChain(chainId);
    // const balance = useBalance({ address: walletAddress, chainId: chain?.id });

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [slippage, setSlippage] = useState(0);
    const [inputSlippage, setInputSlippage] = useState("");
    const [isSlippageAuto, setIsSlippageAuto] = useState(true);
    const [isSlippageHigh, setIsSlippageHigh] = useState(false);
    const [isSlippageVeryHigh, setIsSlippageVeryHigh] = useState(false);

    // const [isTokenSelectOpen, setIsTokenSelectOpen] = useState(false);
    // const [isTokenSelectFrom, setIsTokenSelectFrom] = useState(true);

    const initialTokenFrom = getNativeToken(chainId);
    const initialTokenTo = getFirstNonNativeToken(chainId);

    const [fromToken, setFromToken] = useState<Token>(initialTokenFrom);
    const [toToken, setToToken] = useState<Token>(initialTokenTo);
    
    const [fromTokenBalance, setFromTokenBalance] = useState<bigint | undefined>(0n);
    const [toTokenBalance, setToTokenBalance] = useState<bigint | undefined>(0n);

    // Incrementado apos transacoes que mexem no saldo para forcar a releitura
    const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

    const [fromTokenDecimals, setFromTokenDecimals] = useState<number | undefined>(initialTokenFrom.decimals);
    const [toTokenDecimals, setToTokenDecimals] = useState<number | undefined>(initialTokenTo.decimals);

    // Valores digitados pelo usuario: sempre string, nunca number (18 decimais excedem o float)
    const [fromAmount, setFromAmount] = useState("");
    const [toAmount, setToAmount] = useState("");

    const [fromAllowanceRequired, setFromAllowanceRequired] = useState<bigint>(0n);

    // Incrementado apos um approve para forcar a releitura da allowance
    const [allowanceRefreshKey, setAllowanceRefreshKey] = useState(0);

    const [selectedApprovalMode, setSelectedApprovalMode] = useState("max");

    const [lastSwitchSide, setLastSwitchSide] = useState("");

    // Transacao de escrita: desabilita o botao (req 25) e guarda o erro amigavel (reqs 19-21)
    const [isTxPending, setIsTxPending] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);

    // Derivado no render: o par (texto, wei) e sempre coerente e muda junto com os decimals do token
    const fromAmountWei = useMemo(() => toAmountBigInt(fromAmount, fromTokenDecimals), [fromAmount, fromTokenDecimals]);
    const toAmountWei = useMemo(() => toAmountBigInt(toAmount, toTokenDecimals), [toAmount, toTokenDecimals]);

    // Rede suportada com lista de tokens? Derivado no render, sem estado extra (AGENTS 3.4)
    const isUnsupportedNetwork = !findSupportedChain(chainId) || getTokenList(chainId).length === 0;

    // Qualquer mudanca de chainId (MetaMask OU SwapTokenSelect) volta aos tokens default da nova rede
    // useEffect(() =>
    // {
    //     if(isUnsupportedNetwork)
    //     {
    //         return;
    //     }

    //     const nextFromToken = getNativeToken(chainId);
    //     const nextToToken = getFirstNonNativeToken(chainId);

    //     setFromToken(nextFromToken);
    //     setToToken(nextToToken);
    //     setFromTokenDecimals(nextFromToken.decimals);
    //     setToTokenDecimals(nextToToken.decimals);

    //     // Valores da rede anterior nao valem mais na nova
    //     setFromAmount("");
    //     setToAmount("");
    //     setQuoteSide(null);
    // }, [chainId, isUnsupportedNetwork]);

    useEffect(() =>
    {
        let isCancelled = false;

        async function readTokenBalance(targetChainId: number, token: Token)
        {
            if(!walletAddress)
            {
                return { balance: 0n, decimals: token.decimals };
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
                setFromTokenBalance(undefined);
                setToTokenBalance(undefined);
                return;
            }

            const nextFrom = await readTokenBalance(chainId, fromToken);

            if(isCancelled) return;

            setFromTokenBalance(nextFrom.balance);
            setFromTokenDecimals(nextFrom.decimals);

            const nextTo = await readTokenBalance(chainId, toToken);

            if(isCancelled) return;

            setToTokenBalance(nextTo.balance);
            setToTokenDecimals(nextTo.decimals);
        }

        syncBalances();

        // Cleanup: descarta a resposta de uma rede/token que ja nao e o atual (evita corrida)
        return () => { isCancelled = true; };
    }, [chainId, walletAddress, isUnsupportedNetwork, fromToken.address, toToken.address, balanceRefreshKey]);


    const [quoteSide, setQuoteSide] = useState<QuoteSide | null>(null);

    // AMM da rede: router + wrappedNative vem do config. A lib so recebe o objeto, nao le JSON
    const ammCfg = useMemo(() =>
    {
        const chainConfig = getChainConfig(chainId);

        if(!chainConfig)
        {
            return null;
        }

        return {
            router: chainConfig.router,
            wrappedNative: chainConfig.wrappedNative,
        } as AmmConfig;
    }, [chainId]);

    // Rotas candidatas: direta e via wrappedNative (trocar token/rede reavalia a lista)
    const routes = useMemo(() => (ammCfg ? getRouteCandidates(ammCfg, fromToken, toToken) : []), [ammCfg, fromToken, toToken]);

    // SOMENTE o lado editado alimenta a query - e isto que impede o loop entre os dois inputs
    const quoteAmountWei = quoteSide == "to" ? toAmountWei : fromAmountWei;

    const quoteCalls = useMemo(() =>
    {
        if(!ammCfg || !quoteSide || !isQuotableAmount(quoteAmountWei))
        {
            // O contrato exige amountIn/amountOut > 0: sem valor util nem vale chamar (revert garantido)
            return [];
        }

        return getQuoteCalls(ammCfg, routes, quoteAmountWei, quoteSide);
    }, [ammCfg, quoteSide, quoteAmountWei, routes]);

    const quote = useReadContracts({
        chainId: chain?.id,   // explicito: a chain da UI pode diferir da chain da carteira
        contracts: quoteCalls,
        query: { enabled: quoteCalls.length > 0 },
    });

    // Melhor rota entre as candidatas. Null quando nao ha valor cotavel, entao dado antigo
    // do React Query (query ja desabilitada) nunca volta para os inputs
    const bestQuote = useMemo(() =>
    {
        if(!quoteSide || !isQuotableAmount(quoteAmountWei))
        {
            return null;
        }

        return getBestQuote(quote.data, routes, quoteSide);
    }, [quote.data, routes, quoteSide, quoteAmountWei]);

     // Quanto o usuario paga de fato: no lado "to" e o valor que o reverso (getAmountsIn) calculou
    const payAmountWei = quoteSide == "to" ? (bestQuote ? bestQuote.amountWei : null) : fromAmountWei;

    // Mensagem de estado do swap, derivada no render (sem estado extra - AGENTS 3.4).
    // Ordem: liquidez primeiro (sem ela nao ha valor), saldo depois (reqs 20-21)
    let swapMessage: string | null = null;

    if(quote.isSuccess && !bestQuote && isQuotableAmount(quoteAmountWei))
    {
        swapMessage = INSUFFICIENT_LIQUIDITY_MESSAGE;
    }
    else if(walletAddress && isQuotableAmount(payAmountWei) && fromTokenBalance != null && payAmountWei > fromTokenBalance)
    {
        // Cotacao existe, mas o saldo nao cobre: mostra o valor real + aviso (nao vira 0)
        swapMessage = "Not enough " + fromToken.symbol;
    }

    // Botao de acao: desabilitado quando ha mensagem (sem liquidez/saldo) ou quando ainda
    // nao existe cotacao valida (sem valor digitado ou cotacao em andamento)
    const isSwapDisabled = swapMessage != null || bestQuote == null;

    // const isAllowanceRequired = fromAllowanceRequired > 0n || toAllowanceRequired > 0n;
    const isAllowanceRequired = fromAllowanceRequired > 0n;

    // Espelha a cotacao no input oposto. Escreve SEMPRE no lado que nao e o quoteSide:
    // quoteAmountWei nao muda, a query nao refaz, entao nao existe loop.
    useEffect(() =>
    {
        if(!quoteSide)
        {
            return;
        }

        // Campo esvaziado (ou "0"): limpa o oposto na hora, sem esperar RPC
        if(!isQuotableAmount(quoteAmountWei))
        {
            if(quoteSide == "from")
            {
                setToAmount("");
                return;
            }

            setFromAmount("");
            return;
        }

        // Cotacao valida: espelha o valor
        if(bestQuote)
        {
            if(quoteSide == "from")
            {
                setToAmount(formatEth(bestQuote.amountWei, toTokenDecimals));
                return;
            }

            setFromAmount(formatEth(bestQuote.amountWei, fromTokenDecimals));
            return;
        }

        // Todas as rotas reverteram (sem pool / reserva zero): nao deixar valor antigo na tela
        if(quote.isSuccess)
        {
            if(quoteSide == "from")
            {
                setToAmount("");
                return;
            }

            // Cotacao impossivel em todas as rotas (sem pool, reserva zero, ou saida >= reserva do pool).
            // Mostra "0" como Uniswap/Pancake: vazio significa "sem valor digitado";
            // 0 significa "tem valor, mas nao da para cotar".
            setFromAmount("0");
        }

    }, [bestQuote, quoteAmountWei, quoteSide, fromTokenDecimals, toTokenDecimals, quote.isSuccess]);

    // Effect for token selection or amount changes
    useEffect(() => {
        async function checkSelectedAllowance()
        {
            if(!walletAddress)
            {
                return;
            }

            setFromAllowanceRequired(0n);
            setTxError(null);


            if(isUnsupportedNetwork)
            {
                return;
            }

            const chainConfig = getChainConfig(chainId);

            if(!chainConfig)
            {
                return;
            }

            // Se nada digitado em From, não processa
            if(fromAmount.trim().length == 0)
            {
                return;
            }

            // Se nada digitado em To, não processa
            if(toAmount.trim().length == 0)
            {
                return;
            }

            if(!fromToken.isNative)
            {
                if(fromAmountWei)
                {
                    const ownerAddress = getAddress(walletAddress);
                    const tokenAddress = getAddress(fromToken.address);
                    const spender = getAddress(chainConfig.router);
                    const fromAllowance = await getAllowance(chainId, ownerAddress, spender, tokenAddress);
                    // console.log(`From Allowance: ${fromAllowance}`);

                    if(fromAmountWei > fromAllowance)
                    {
                        const requiredAllowance = fromAmountWei - fromAllowance;
                        setFromAllowanceRequired(requiredAllowance);
                    }
                }
            }

        }

        checkSelectedAllowance();    
    }, [fromAmount, toAmount, fromToken, toToken, allowanceRefreshKey, walletAddress, chainId]);


    function OnNotification(message: string, messageType: "success" | "error" | "info", duration: number)
    {
        setNotification({
            id: Date.now().toString(),
            message,
            messageType,
            duration,
            onClose: ()=>{
                setNotification(null);
            }
        });
    }

    function OnSettingsButtonClick()
    {
        setIsSettingsOpen(true);
    }

    function setSlippageToAuto()
    {
        setInputSlippage("");
        setSlippage(0);
        setIsSlippageAuto(true);
        setIsSlippageHigh(false);
        setIsSlippageVeryHigh(false);

    }

    function OnSettingsSlippageAutoButtonClick()
    {
        setSlippageToAuto();
    }

    function OnSlippageSwapSettingsInputChange(value: string)
    {
        let newValue = 0;

        if(!value)
        {
            setSlippageToAuto();
            return;
        }

        if(value.trim().length == 0)
        {
            setSlippageToAuto();
            return;
        }

        newValue = parseFloat(value);
        newValue = parseFloat(newValue.toFixed(2));

        if(isNaN(newValue))
        {
            return;
        }

        if(newValue > 100)
        {
            newValue = 100;
            setInputSlippage("100");
            setSlippage(newValue);
            setIsSlippageAuto(false);
            setIsSlippageHigh(false);
            setIsSlippageVeryHigh(true);
            return;
        }

        if(newValue < 0)
        {
            setSlippageToAuto();
            return;
        }

        // Danger slippage
        if(newValue > 5 && newValue < 20)
        {
            // ⚠️ High
            setIsSlippageHigh(true);
            setIsSlippageVeryHigh(false);
        }
        else if(newValue >= 20)
        {
            // ⛔️ Too High
            setIsSlippageHigh(false);
            setIsSlippageVeryHigh(true);
        }
        else
        {
            // 🟢 Ok
            setIsSlippageHigh(false);
            setIsSlippageVeryHigh(false);
        }

        setSlippage(newValue);

        if(newValue == 0)
        {
            setSlippageToAuto();
        }
        else
        {
            setIsSlippageAuto(false);
        }

        // regex: Allows numbers, a single decimal point, and negative signs
        if (value === "" || /^-?\d*\.?\d*$/.test(value)) 
        {
            setInputSlippage(value);
        }
    }

    function OnTokenSelectChainIdChanged(value: number)
    {
        // closeTokenSelect();

        if(value === chainId)
        {
            return;
        }

        // Apenas o comando: o efeito de [chainId] prepara defaults + saldos
        changeChainId(value);
    }

    function OnTokenSelectFromButtonClick()
    {
        setIsTokenSelectFrom(true);
        
        setIsTokenSelectOpen(true);
    }

    function OnTokenSelectToButtonClick()
    {
        setIsTokenSelectFrom(false);

        setIsTokenSelectOpen(true);
    }

    function closeTokenSelect()
    {
        setIsTokenSelectOpen(false);
    }

    function OnTokenSelected(tokenAddress: string)
    {
        closeTokenSelect();

        const token = findToken(chainId, tokenAddress);
        if(!token) return;


        if(isTokenSelectFrom)
        {
            setFromToken(token);
            setFromTokenDecimals(token.decimals);
        }
        else
        {
            setToToken(token);
            setToTokenDecimals(token.decimals);
        }
    }


    // Entrada numerica: mantem o texto exatamente como digitado; so descarta o evento se o formato for invalido
    function OnFromAmountChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        setFromAmount(value);
        setQuoteSide("from");
    }

    function OnToAmountChange(value: string)
    {
        if(!isValidAmountInput(value))
        {
            return;
        }

        setToAmount(value);
        setQuoteSide("to");
    }

    function OnSwitchFromToClick()
    {
        const prevFromToken: Token = fromToken;
        const prevToToken: Token = toToken;

        const prevToAmount = toAmount;
        const prevFromAmount = fromAmount;

        // Limpa as cotações
        setFromAmount("");
        setToAmount("");
        setQuoteSide(null);

        // Inverte as posições dos tokens
        setFromToken(prevToToken);
        setFromTokenDecimals(prevToToken.decimals);
        
        setToToken(prevFromToken);
        setToTokenDecimals(prevFromToken.decimals);

        if(lastSwitchSide === "from")
        {
            // Coloca o valor anterior em From no To para recalcular
            setToAmount(prevFromAmount);
            setQuoteSide("to");
            setLastSwitchSide("to");
        }
        else
        {
            // Coloca o valor anterior em To no From para recalcular
            setFromAmount(prevToAmount);
            setQuoteSide("from");
            setLastSwitchSide("from");
        }
    }

    function OnApprovalModeChange(event: React.ChangeEvent<HTMLInputElement>)
    {
        if(event.target.value !== "max" && event.target.value !== "exact")
        {
            return;
        }

        setSelectedApprovalMode(event.target.value);
    }

    async function OnApproveTokenClick()
    {
        // `amm` ja e o memo do router da rede
        if(!ammCfg || isTxPending)
        {
            return;
        }

        const amountToApprove = selectedApprovalMode === "max" ? maxUint256 : (fromAllowanceRequired);
        
        // A allowance do lado "to" é irrelevante para o swap - Somente o lado from é validado para allowance
        // const token = fromAllowanceRequired > 0 ? fromToken : toToken;
        const token = fromToken;

        // O nativo nao tem approve: quem paga gas e o proprio nativo
        if(token.isNative)
        {
            return;
        }

        setIsTxPending(true);
        setTxError(null);

        try
        {
            OnNotification(`Approving ${token.symbol}...`, "info", 60000);

            const tokenAddress = getAddress(token.address);
            const func: ContractWriteCall = getTokenApproveFunction(tokenAddress, ammCfg.router, amountToApprove);
            await callContractWrite(chainId, func);

            // Sem deficit: o botao volta a ser "Swap" enquanto a allowance e relida on-chain
            setFromAllowanceRequired(0n);
            setAllowanceRefreshKey((key) => key + 1);
            setBalanceRefreshKey((key) => key + 1);

            OnNotification(token.symbol + " approved.", "success", 3000);
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
        // if(fromAllowanceRequired)
        // {
        //     console.log(`Approve ${fromToken.symbol}`);
        // }
        // else if(toAllowanceRequired)
        // {
        //     console.log(`Approve ${toToken.symbol}`);
        // }


    }

    async function OnSwapClick()
    {
        // console.log(`From ${fromAmountWei} ${fromToken.symbol}`);
        // console.log(`To ${toAmountWei} ${toToken.symbol}`);

        // OnNotification(`From ${fromAmountWei} ${fromToken.symbol}`, "info", 8000);

        if(!ammCfg || isTxPending || !quoteSide || !isQuotableAmount(quoteAmountWei) || !bestQuote)
        {
            return;
        }

        const chain = findSupportedChain(chainId);

        if(!chain)
        {
            return;
        }

        if(!walletAddress)
        {
            return;
        }

        // Auto (0) nao pode virar tolerancia zero: usa um piso minimo tambem no submit, então 0 = default (1.5)
        const DEFAULT_SLIPPAGE_AUTO = 1.5;
        const slippageTolerance = slippage > 0 ? slippage : DEFAULT_SLIPPAGE_AUTO;

        setIsTxPending(true);
        setTxError(null);


        try
        {
            // Recotiza fresco: o cache do useReadContracts nao acompanha o bloco (sem refetchInterval)
            const freshEntries = await readContracts(wagmiConfig, {
                contracts: getQuoteCalls(ammCfg, routes, quoteAmountWei, quoteSide),
                allowFailure: true,
            });

            const freshQuote = getBestQuote(freshEntries, routes, quoteSide);

            // Sem cotacao fresca OU desvio acima do slippage configurado -> nao assina
            if(!freshQuote || !isQuoteWithinSlippage(bestQuote.amountWei, freshQuote.amountWei, slippageTolerance))
            {
                const message = "Price moved beyond your slippage tolerance. Review and try again.";
                setTxError(message);
                OnNotification(message, "error", 10000);
                return;
            }


            // O Router nao tem swap exact-out: o submit e sempre exact-in.
            //   quoteSide "from": entrada = o digitado; saida   = cotacao fresca
            //   quoteSide "to":   saida   = o pedido;  entrada = o que a cotacao fresca exigiu
            const amountInWei = quoteSide == "to" ? freshQuote.amountWei : fromAmountWei;
            const expectedOutWei = quoteSide == "to" ? toAmountWei : freshQuote.amountWei;

            if(!isQuotableAmount(amountInWei) || !isQuotableAmount(expectedOutWei))
            {
                return;
            }

            // Mesmo slippage do gate de drift (nao o "slippage" cru, que e 0 no Auto)
            // Passou na tolerancia: piso a partir da cotacao + deadline
            const toleranceBps = BigInt(Math.round(slippageTolerance * 100));
            const amountOutMin = (expectedOutWei * (10000n - toleranceBps)) / 10000n;

            // Slippage de 100% zeraria o piso: sem protecao real, nao envia
            if(amountOutMin <= 0n)
            {
                const message = "Slippage tolerance is too high for this trade.";
                setTxError(message);
                OnNotification(message, "error", 10000);
                return;
            }

            const recipient = getAddress(walletAddress);



            // Montar ContractWriteCall por freshQuote.route.kind
            //   token-to-token   -> swapExactTokensForTokens(fromAmountWei, amountOutMin, path, to, deadline)
            //   native-to-token  -> swapExactNativeForTokens(amountOutMin, path, to, deadline) + value
            //   token-to-native  -> swapExactTokensForNative(fromAmountWei, amountOutMin, path, to, deadline)
            // e chamar callContractWrite(chainId, call) (lib/tx.ts:58)

            let swapCall: ContractWriteCall;
                        const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

            if(freshQuote.route.kind == "native-to-token")
            {
                // payable: o nativo sai como value; o path[0] ja e o wrappedNative
                swapCall = {
                    address: ammCfg.router,
                    abi: routerAbi,
                    functionName: "swapExactNativeForTokens",
                    args: [ amountOutMin, freshQuote.route.path, recipient, deadline ],
                    value: amountInWei,
                };
            }
            else if(freshQuote.route.kind == "token-to-native")
            {
                // o path[last] ja e o wrappedNative; o Router faz o unwrap e envia o nativo
                swapCall = {
                    address: ammCfg.router,
                    abi: routerAbi,
                    functionName: "swapExactTokensForNative",
                    args: [ amountInWei, amountOutMin, freshQuote.route.path, recipient, deadline ],
                };
            }
            else
            {
                swapCall = {
                    address: ammCfg.router,
                    abi: routerAbi,
                    functionName: "swapExactTokensForTokens",
                    args: [ amountInWei, amountOutMin, freshQuote.route.path, recipient, deadline ],
                };
            }

            OnNotification(`Swapping ${fromToken.symbol} for ${toToken.symbol}...`, "info", 60000);

            // buildContractWriteRequest valida chain da carteira vs chainId e faz simulate (revert/gas/saldo)
            await callContractWrite(chainId, swapCall);

            // Ativa a chave de atualização dos saldos
            setBalanceRefreshKey((key) => key + 1);

            OnNotification(`${fromToken.symbol} swapped for ${toToken.symbol}.`, "success", 3000);

            // Os valores exibidos nao valem mais: limpa os inputs e reavalia a allowance
            setFromAmount("");
            setToAmount("");
            setQuoteSide(null);
            setAllowanceRefreshKey((key) => key + 1);
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

    return (
        <div className="swap-card w-full max-w-[480px] p-4 rounded-3xl border shadow-xl">

            {/* Header */}
            <div className="flex justify-between items-center mb-3 px-1">
                <div className="flex gap-4 font-medium">
                    <button className="swap-header-button-selected border-b-2 pb-1">Swap</button>
                    <button className="swap-header-button pb-1">Liquidity Pools</button>
                </div>
                
                <div className="flex justify-between items-center gap-1">
                    <button 
                        className="swap-header-button flex justify-between items-center gap-1"
                        onClick={() => {OnSettingsButtonClick()} }>

                        {isSlippageHigh && <TriangleAlert className="swap-slippage-warning-value" />}
                        {isSlippageVeryHigh && <TriangleAlert className="swap-slippage-critical-value" />}

                        {slippage > 0 && (
                            <span className={"swap-slippage-percent-value text-sm " + (isSlippageHigh ? "swap-slippage-warning-value" : (isSlippageVeryHigh ? "swap-slippage-critical-value" : ""))}>
                                {slippage}%
                            </span>
                        )}


                        <Settings className="w-4 h-4" />
                    </button>
                </div>

            </div>

            {/* Input Panel Container */}
            <div className="flex flex-col gap-1">
                {/* Sell Panel (FROM) */}
                <div className="swap-input-panel p-4 rounded-2xl border border-transparent transition-all">
                    <label className="swap-label text-xs block mb-1">You pay</label>
                    <div className="flex items-center justify-between">
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            autoComplete="off"
                            spellCheck={false}
                            aria-label="Amount to pay"
                            value={fromAmount}
                            onChange={(event) => {OnFromAmountChange(event.target.value)}}
                            className="swap-input bg-transparent text-3xl w-full focus:outline-none font-medium pr-2"
                        />

                        {/* Botão de Seleção de Token (Substituindo o Select) */}
                        <button 
                            className="swap-token-select-btn flex items-center gap-2 transition-colors pl-2 pr-3 py-1.5 rounded-2xl font-semibold shadow-sm"
                            onClick={() => {OnTokenSelectFromButtonClick()}}
                        >

                            {/* Ícone/Círculo do Token */}
                            <Image 
                                src={fromToken.logoURI}
                                alt={fromToken.name}
                                width={24} 
                                height={24} 
                                className="rounded-full"
                            />
                            <span className="text-base font-semibold">{fromToken.symbol}</span>
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                        </button>
                    </div>

                    <div className="swap-token-balance text-xs mt-2 text-right">
                        Balance: {fromTokenBalance && fromTokenDecimals ? formatEth(fromTokenBalance, fromTokenDecimals) : "0.00"}
                    </div>

                </div>

                {/* Switch Button Arrow */}
                <div className="relative h-0 flex items-center justify-center z-10">
                    <button
                        onClick={OnSwitchFromToClick}
                        className="swap-button-arrow border-4 p-2 rounded-xl hover:scale-105 transition-all shadow-md"
                    >
                        <ArrowDownUp className="w-4 h-4" />
                    </button>
                </div>

                {/* Buy Panel (TO) */}
                <div className="swap-input-panel p-4 rounded-2xl border border-transparent transition-all">
                    <label className="swap-label text-xs block mb-1">You receive</label>
                    <div className="flex items-center justify-between">
                        <input
                            type="text"
                            placeholder="0"
                            autoComplete="off"
                            spellCheck={false}
                            aria-label="Amount to receive"
                            value={toAmount}
                            onChange={(event) => {OnToAmountChange(event.target.value)}}
                            className="swap-input bg-transparent text-3xl w-full focus:outline-none font-medium pr-2"
                        />

                        {/* Botão de Seleção de Token (Substituindo o Select) */}
                        <button 
                            className="swap-token-select-btn flex items-center gap-2 transition-colors pl-2 pr-3 py-1.5 rounded-2xl font-semibold shadow-sm"
                            onClick={() => {OnTokenSelectToButtonClick()}}
                            >

                            {/* Ícone/Círculo do Token */}
                            <Image 
                                src={toToken.logoURI}
                                alt={toToken.name}
                                width={24} 
                                height={24} 
                                className="rounded-full"
                            />
                            <span className="text-base font-semibold">{toToken.symbol}</span>
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                        </button>
                    </div>

                    <div className="swap-token-balance text-xs mt-2 text-right">
                        Balance: {toTokenBalance && toTokenDecimals ? formatEth(toTokenBalance, toTokenDecimals) : "0.00"}
                    </div>
                </div>


            </div>

            {/* Ação de carteira: quando conectado o botao some e fica so o Swap */}
            <ConnectWalletButton variant="swap" />

            {isConnected && !isAllowanceRequired && (
                <button 
                    onClick={() => {OnSwapClick()}}
                    disabled={isSwapDisabled}
                    className={(!isSwapDisabled ? "swap-action-button" : "swap-action-button-disabled") + " w-full mt-3 transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"}
                >

                    {swapMessage ?? "Swap"}
                </button>
            )}


            {isConnected && isAllowanceRequired && (
                <div>
                    <div>
                        <label className="swap-label text-xs block mt-3 mb-1">Approval Mode</label>
                    </div>
                    <div className="flex gap-10 justify-center">
                        <div className="flex gap-2">
                            <input 
                                type="radio" 
                                name="approval-mode"
                                id="approval-mode-max"
                                value="max"
                                checked={selectedApprovalMode === "max"}
                                onChange={OnApprovalModeChange}
                                className="swap-radio-button w-5 h-5 appearance-none rounded-full border-2 transition-all duration-200 relative before:content-[''] before:absolute before:inset-1 before:rounded-full before:scale-0 checked:before:scale-100"
                            />
                            <label htmlFor="approval-mode-max" className="swap-radio-button-label font-medium text-sm">Highest possible - Just once</label>
                        </div>
                        <div className="flex gap-2">
                            <input 
                                type="radio" 
                                name="approval-mode"
                                id="approval-mode-exact"
                                value="exact"
                                checked={selectedApprovalMode === "exact"}
                                onChange={OnApprovalModeChange}
                                className="swap-radio-button w-5 h-5 appearance-none rounded-full border-2 transition-all duration-200 relative before:content-[''] before:absolute before:inset-1 before:rounded-full before:scale-0 checked:before:scale-100"
                            />
                            <label htmlFor="approval-mode-exact" className="swap-radio-button-label font-medium text-sm">Exact amount</label>
                        </div>

                    </div>
                    <button 
                        onClick={OnApproveTokenClick}
                        className={(!isSwapDisabled && !isTxPending ? "swap-action-button" : "swap-action-button-disabled") + " w-full mt-3 transition-colors py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"}
                        disabled={isSwapDisabled || isTxPending}
                    >
                        {isTxPending ? "Approving..." : (swapMessage ?? "Approve " + (fromToken.symbol))}
                    </button>
                    {txError && (<div className="swap-tx-error text-sm text-center">{txError}</div>)}
                </div>
            )}

            

            {/* Renderização condicional */}
            {notification && (<NotificationCard key={notification.id} id={notification.id} message={notification.message} messageType={notification.messageType} duration={notification.duration} onClose={notification.onClose} />)}
            {isSettingsOpen && (<SwapSettings onClose={() => setIsSettingsOpen(false)} inputSlippage={inputSlippage} OnSlippageSwapSettingsInputChange={OnSlippageSwapSettingsInputChange} OnSettingsSlippageAutoButtonClick={OnSettingsSlippageAutoButtonClick} isSlippageAuto={isSlippageAuto} isSlippageHigh={isSlippageHigh} isSlippageVeryHigh={isSlippageVeryHigh} />)}
            {isTokenSelectOpen && (<SwapTokenSelect onClose={() => closeTokenSelect()} isTokenSelectFrom={isTokenSelectFrom} chainId={chainId} walletAddress={walletAddress} OnTokenSelectChainIdChanged={OnTokenSelectChainIdChanged} OnTokenSelected={OnTokenSelected} />)}
        </div>
    )
}

export default SwapForm;