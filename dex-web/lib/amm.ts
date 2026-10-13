import type { Address, ContractFunctionParameters } from "viem";
import { getAddress } from "viem";
import { routerAbi } from "@/lib/abi/router";
import type { Token } from "@/lib/tokens";

// Lado do formulario editado pelo usuario: define a direcao da cotacao e evita loop entre os inputs
export type QuoteSide = "from" | "to";

// Dados do AMM da chain, derivados de config/chains (getAmmConfig). A lib nao le JSON.
export interface AmmConfig
{
    router: Address;
    wrappedNative: Address;
    // Opcional: usado apenas no rotulo da nota "Route: ..."
    wrappedNativeSymbol?: string;
}

// Define a chamada de swap no submit: nativo exige value; ERC-20 exige approve + transferFrom
export type SwapPathKind = "token-to-token" | "native-to-token" | "token-to-native";

export interface AmmRoute
{
    path: Address[];
    kind: SwapPathKind;
    label: string;
}

export interface AmmQuote
{
    route: AmmRoute;
    amountWei: bigint;
}

// O Router reverte quando o pool nao existe ou a reserva e zero. Nunca devolve "0 = sem liquidez".
export const INSUFFICIENT_LIQUIDITY_MESSAGE = "Insufficient liquidity for this trade.";

// getAmountsOut = exact-in (quanto sai); getAmountsIn = exact-out (quanto precisa entrar).
// O Router nao tem swap exact-out: o lado "to" e sempre um reverso que vira exact-in no submit.
type QuoteFunctionName = "getAmountsOut" | "getAmountsIn";

// Formato minimo do retorno do useReadContracts (allowFailure = true): a falha vem por item, sem throw
export interface AmmReadEntry
{
    status: "success" | "failure";
    result?: unknown;
}

// Endereco normalizado (checksum) ou null: endereco invalido (ex.: vindo de querystring) nao quebra o render
function normalizeTokenAddress(token: Token | undefined): Address | null
{
    if(!token)
    {
        return null;
    }

    try
    {
        return getAddress(token.address);
    }
    catch
    {
        return null;
    }
}

// Deriva de isNative, nao do endereco: o wrappedNative escolhido como ERC-20 na lista e token-to-token
function resolvePathKind(fromToken: Token, toToken: Token): SwapPathKind
{
    if(fromToken.isNative == true)
    {
        return "native-to-token";
    }

    if(toToken.isNative == true)
    {
        return "token-to-native";
    }

    return "token-to-token";
}

// Rotas candidatas: direta e via wrappedNative (neste deploy os pools sao criados contra o nativo).
// Nao repete o hop quando um lado ja e o nativo e descarta from == to (o contrato reverteria).
export function getRouteCandidates(amm: AmmConfig, fromToken: Token, toToken: Token): AmmRoute[]
{
    const from = normalizeTokenAddress(fromToken);
    const to = normalizeTokenAddress(toToken);

    if(!from || !to || from == to)
    {
        return [];
    }

    const kind = resolvePathKind(fromToken, toToken);

    const routes: AmmRoute[] = [
        {
            path: [ from, to ],
            kind: kind,
            label: fromToken.symbol + " -> " + toToken.symbol,
        },
    ];

    const isNativeSide = fromToken.isNative == true || toToken.isNative == true;

    // Se um dos lados ja e o nativo, a rota direta ja passa pelo wrappedNative
    if(!isNativeSide)
    {
        routes.push({
            path: [ from, getAddress(amm.wrappedNative), to ],
            kind: kind,
            label: fromToken.symbol + " -> " + (amm.wrappedNativeSymbol ?? "wrapped native") + " -> " + toToken.symbol,
        });
    }

    return routes;
}

// O contrato exige amountIn/amountOut > 0: nunca chamar a cotacao sem valor util (revert garantido)
export function isQuotableAmount(amountWei: bigint | null | undefined): amountWei is bigint
{
    return amountWei != null && amountWei > 0n;
}

// Chamadas para o useReadContracts: um item por rota, mesma funcao para todas.
// O tipo e afrouxado de proposito - o retorno bruto e validado em runtime em getBestQuote.
export function getQuoteCalls(amm: AmmConfig, routes: AmmRoute[], amountWei: bigint, quoteSide: QuoteSide): ContractFunctionParameters[]
{
    const functionName: QuoteFunctionName = quoteSide == "from" ? "getAmountsOut" : "getAmountsIn";

    return routes.map((route) => ({
        address: amm.router,
        abi: routerAbi,
        functionName: functionName,
        args: [ amountWei, route.path ],
    })) as ContractFunctionParameters[];
}

// Ponta do array de amounts que interessa ao input oposto:
//   quoteSide "from" -> ultimo elemento (saida esperada)
//   quoteSide "to"   -> primeiro elemento (entrada necessaria, ja arredondada para cima pelo +1 do contrato)
function readQuoteAmount(entry: AmmReadEntry | undefined, quoteSide: QuoteSide): bigint | null
{
    if(!entry || entry.status != "success" || !Array.isArray(entry.result))
    {
        return null;
    }

    const amounts = entry.result;

    if(amounts.length < 2)
    {
        return null;
    }

    const value: unknown = quoteSide == "from" ? amounts[amounts.length - 1] : amounts[0];

    if(typeof value != "bigint" || value <= 0n)
    {
        // getAmountOut arredonda para baixo e pode devolver 0 numa quantidade poeira
        return null;
    }

    return value;
}

// exact-in (from): maior saida ganha. exact-out (to): menor entrada ganha.
function isBetterQuote(amountWei: bigint, bestAmountWei: bigint, quoteSide: QuoteSide): boolean
{
    return quoteSide == "from" ? amountWei > bestAmountWei : amountWei < bestAmountWei;
}

// Melhor cotacao entre as rotas: descarta as que reverteram e aplica a direcao do quoteSide.
// Sem cotacao valida => sem liquidez (a UI mostra INSUFFICIENT_LIQUIDITY_MESSAGE).
export function getBestQuote(entries: readonly AmmReadEntry[] | undefined, routes: AmmRoute[], quoteSide: QuoteSide): AmmQuote | null
{
    if(!entries)
    {
        return null;
    }

    let best: AmmQuote | null = null;

    for(let index = 0; index < routes.length; index++)
    {
        const amountWei = readQuoteAmount(entries[index], quoteSide);

        if(amountWei == null)
        {
            continue;
        }

        if(best == null || isBetterQuote(amountWei, best.amountWei, quoteSide))
        {
            best = { route: routes[index], amountWei: amountWei };
        }
    }

    return best;
}

// Relacao entre o valor exibido e a cotacao fresca. slippage em % (ex.: 0.5 = 0.5%).
// Serve para bloquear o submit quando o pool andou mais que a tolerancia do usuario.
export function isQuoteWithinSlippage(quotedWei: bigint, freshWei: bigint, slippagePercent: number): boolean
{
    if(quotedWei <= 0n)
    {
        return false;
    }

    const diff = freshWei > quotedWei ? freshWei - quotedWei : quotedWei - freshWei;

    // % -> basis points inteiros, evitando float no bigint do valor
    const toleranceBps = BigInt(Math.max(0, Math.round(slippagePercent * 100)));
    const toleranceWei = (quotedWei * toleranceBps) / 10000n;

    return diff <= toleranceWei;
}
