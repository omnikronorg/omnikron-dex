import type { Address, Chain, Hex, PublicClient } from "viem";
import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError, createPublicClient, formatUnits, getAddress, http, isAddress, parseUnits } from "viem";
import { erc20Abi } from "@/lib/abi/erc20";
import { findSupportedChain } from "@/lib/chains";

// Clientes publicos por chain, criados sob demanda (leitura nao depende da carteira)
const publicClients = new Map<number, PublicClient>();

export function getPublicClient(chainId: number): PublicClient
{
    const cached = publicClients.get(chainId);

    if(cached)
    {
        return cached;
    }

    const chain: Chain | undefined = findSupportedChain(chainId);

    if(!chain)
    {
        throw new Error("Rede nao suportada: " + chainId);
    }

    const client = createPublicClient({ chain, transport: http() });
    publicClients.set(chainId, client);

    return client;
}

// Endereco valido (EIP-55 opcional) e normalizado em checksum
export function isValidAddress(value: string): boolean
{
    return isAddress(value);
}

export function normalizeAddress(value: string): Address | null
{
    return isAddress(value) ? getAddress(value) : null;
}

export function parseTokenAmount(value: string, decimals: number): bigint
{
    return parseUnits(value, decimals);
}

export function formatTokenAmount(value: bigint, decimals: number): string
{
    return formatUnits(value, decimals);
}

export async function getBalance(chainId: number, walletAddress: Address): Promise<bigint>
{
    return getPublicClient(chainId).getBalance({ address: walletAddress });
}

// Decimais do token nativo: nao existe chamada on-chain, vem da definicao da chain
export function getNativeTokenDecimals(chainId: number): number
{
    const chain = findSupportedChain(chainId);

    // Todas as redes suportadas usam 18; o fallback evita quebrar a UI em rede desconhecida
    return chain?.nativeCurrency.decimals ?? 18;
}

export async function getTokenBalance(chainId: number, walletAddress: Address, tokenAddress: Address): Promise<bigint>
{
    return getPublicClient(chainId).readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ walletAddress ],
    });
}

export async function getTokenSymbol(chainId: number, tokenAddress: Address): Promise<string>
{
    return getPublicClient(chainId).readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" });
}

export async function getTokenDecimals(chainId: number, tokenAddress: Address): Promise<number>
{
    return getPublicClient(chainId).readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" });
}

export async function getTokenName(chainId: number, tokenAddress: Address): Promise<string>
{
    return getPublicClient(chainId).readContract({ address: tokenAddress, abi: erc20Abi, functionName: "name" });
}

export async function getTotalSupply(chainId: number, tokenAddress: Address): Promise<bigint>
{
    return getPublicClient(chainId).readContract({ address: tokenAddress, abi: erc20Abi, functionName: "totalSupply" });
}

export async function getAllowance(chainId: number, owner: Address, spender: Address, tokenAddress: Address): Promise<bigint>
{
    return getPublicClient(chainId).readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [ owner, spender ],
    });
}

export interface TokenInfo
{
    address: Address;
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: bigint;
    balance?: bigint;
    formattedBalance?: string;
}

// Uma unica chamada RPC (multicall) para buscar os metadados do token
export async function getTokenAllInfo(chainId: number, tokenAddress: Address, walletAddress?: Address): Promise<TokenInfo | null>
{
    const client = getPublicClient(chainId);

    try
    {
        const [ name, symbol, decimals, totalSupply ] = await client.multicall({
            contracts: [
                { address: tokenAddress, abi: erc20Abi, functionName: "name" },
                { address: tokenAddress, abi: erc20Abi, functionName: "symbol" },
                { address: tokenAddress, abi: erc20Abi, functionName: "decimals" },
                { address: tokenAddress, abi: erc20Abi, functionName: "totalSupply" },
            ],
            allowFailure: false,
        });

        const balance = walletAddress ? await getTokenBalance(chainId, walletAddress, tokenAddress) : undefined;

        return {
            address: tokenAddress,
            name,
            symbol,
            decimals,
            totalSupply,
            balance,
            formattedBalance: balance !== undefined ? formatUnits(balance, decimals) : undefined,
        };
    }
    catch
    {
        // Token invalido ou fora do padrao ERC-20
        return null;
    }
}

export interface TxInfo
{
    hash: Hex;
    status: "pending" | "success" | "reverted";
    from: Address;
    to: Address | null;
    value: bigint;
    blockNumber?: bigint;
    gasUsed?: bigint;
}

export async function getTxInfo(chainId: number, hash: Hex): Promise<TxInfo | null>
{
    const client = getPublicClient(chainId);

    try
    {
        const transaction = await client.getTransaction({ hash });

        try
        {
            const receipt = await client.getTransactionReceipt({ hash });

            return {
                hash,
                status: receipt.status,
                from: receipt.from,
                to: receipt.to,
                value: transaction.value,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed,
            };
        }
        catch
        {
            // Sem receipt ainda: transacao pendente
            return { hash, status: "pending", from: transaction.from, to: transaction.to, value: transaction.value };
        }
    }
    catch
    {
        // Hash desconhecido na rede
        return null;
    }
}

// Leitura generica de qualquer contrato (view/pure)
export async function callContractRead(chainId: number, contractAddress: Address, abi: readonly unknown[], functionName: string, parameters: readonly unknown[])
{
    return getPublicClient(chainId).readContract({
        address: contractAddress,
        abi,
        functionName,
        args: parameters,
    });
}

// Converte os erros do viem/wagmi em mensagens claras para a UI (reqs 19-21)
export function getFriendlyErrorMessage(error: unknown): string
{
    if(!(error instanceof BaseError))
    {
        return error instanceof Error ? error.message : "The operation could not be completed.";
    }

    const rejected = error.walk((item) => item instanceof UserRejectedRequestError);

    if(rejected)
    {
        return "Transaction rejected in the wallet.";
    }

    const reverted = error.walk((item) => item instanceof ContractFunctionRevertedError);

    if(reverted instanceof ContractFunctionRevertedError)
    {
        return reverted.reason ?? "The transaction was reverted by the blockchain.";
    }

    const funds = error.walk((item) => item instanceof InsufficientFundsError);

    if(funds)
    {
        return "Insufficient funds to pay for the transaction and gas.";
    }

    return error.shortMessage;
}
