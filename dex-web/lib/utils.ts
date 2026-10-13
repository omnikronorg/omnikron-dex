import { formatUnits } from "viem";
import { parseTokenAmount } from "./evm";

// Regex frouxa: usada a cada tecla, aceita estados intermediarios de digitacao ("", "12", "12.", ".5")
const TYPING_AMOUNT = /^\d*\.?\d*$/;

// Regex estrita: usada so antes do parseUnits, exige pelo menos um digito
const PARSEABLE_AMOUNT = /^(?:\d+\.?\d*|\.\d+)$/;


export function formatEth(value: bigint | undefined, decimals: number | undefined)
{
    if(!value)
    {
        return "";
    }

    if(!decimals)
    {
        decimals = 18;
    }

    return formatUnits(value, decimals);
}

// Valida o texto digitado sem reescrever o valor (reescrever faria o cursor pular para o fim)
export function isValidAmountInput(value: string): boolean
{
    if(value.includes("e") || value.includes("E"))
    {
        // Notacao cientifica nunca e um valor desejado; "1e18" viraria "118" se fosse limpo
        return false;
    }

    return TYPING_AMOUNT.test(value);
}

export function isParseableAmountInput(value: string): boolean
{
    return PARSEABLE_AMOUNT.test(value);
}

// Trunca casas decimais extras: o viem arredonda silenciosamente, entao cortar evita
// que o usuario veja um valor diferente do que sera usado na transacao
export function clampAmountDecimals(value: string, maxDecimals: number): string
{
    const [integer, fraction] = value.split(".");

    if(fraction === undefined)
    {
        return integer;
    }

    return integer + "." + fraction.slice(0, maxDecimals);
}

// Converte o texto ja validado em bigint para a cotacao/transacao; null quando nao ha valor utilizavel
export function toAmountBigInt(value: string, decimals: number | undefined): bigint | null
{
    if(!decimals || !isParseableAmountInput(value))
    {
        return null;
    }

    try
    {
        return parseTokenAmount(clampAmountDecimals(value, decimals), decimals);
    }
    catch
    {
        // Formato aceito pela regex mas rejeitado pelo viem: trata como "sem valor"
        return null;
    }
}

// Formata a cotacao para exibicao no input: truncando (nunca para cima) e sem float
export function formatQuoteAmount(value: bigint | null, decimals: number | undefined, maxFractionDigits = 6): string
{
    if(value == null || value <= 0n)
    {
        return "";
    }

    const fractions = formatEth(value, decimals ?? 18).split(".");

    if(fractions.length < 2)
    {
        return fractions[0];
    }

    return fractions[0] + "." + fractions[1].slice(0, maxFractionDigits);
}

