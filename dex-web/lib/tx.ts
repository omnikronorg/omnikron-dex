import type { Address, Hex } from "viem";
import { erc20Abi } from "viem";
import { getConnection, simulateContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import { findSupportedChain } from "@/lib/chains";

// Descriptor generico de escrita: equivalente ao functionObject do signAndSendTx
export interface ContractWriteCall
{
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;          // payable: swapExactNativeForTokens, addLiquidityNative, etc.
}

// "Monta a transaction": encode + simulate (revert/gas/saldo)
export async function buildContractWriteRequest(chainId: number, call: ContractWriteCall)
{
    // guarda de rede antes de assinar
    const connection = getConnection(wagmiConfig);

    if(!connection.isConnected || !connection.address)
    {
        throw new Error("Connect your wallet to continue.");
    }

    // A carteira precisa estar na rede da UI: evita assinar na chain errada (AGENTS 7)
    if(connection.chainId !== chainId)
    {
        throw new Error("Switch your wallet network to continue.");
    }

    // Estreita o number para a uniao literal das chains do config (o wagmi nao aceita chainId generico)
    const chain = findSupportedChain(chainId);

    if(!chain)
    {
        throw new Error("Rede nao suportada: " + chainId);
    }

    // O abi nao e literal, entao o viem deriva "value?: undefined" (GetMutabilityAwareValue):
    // so um abi "as const" permite ver que a funcao e payable. O cast e so de tipo - o bigint
    // segue no request montado pelo simulateContract e chega ao writeContract.
    const { request } = await simulateContract(wagmiConfig, {
        address: call.address,
        abi: call.abi,
        functionName: call.functionName,
        args: call.args,
        value: call.value as undefined,
        chainId: chain.id,
    });

    return request;
}

// Assina na carteira, envia e aguarda 1 confirmacao
export async function callContractWrite(chainId: number, call: ContractWriteCall)
{
    const chain = findSupportedChain(chainId);

    if(!chain)
    {
        throw new Error("Rede nao suportada: " + chainId);
    }

    const request = await buildContractWriteRequest(chainId, call);

    const hash: Hex = await writeContract(wagmiConfig, request);
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: chain.id });

    if(receipt.status === "reverted") 
    { 
        throw new Error("The transaction was reverted by the blockchain."); 
    }

    return { hash, receipt };
}

// Obtem a descriptor da função de aprovação de um token
export function getTokenApproveFunction(tokenAddress: Address, spender: Address, amount: bigint): ContractWriteCall
{
    return { 
        address: tokenAddress, 
        abi: erc20Abi, 
        functionName: "approve", 
        args: [ spender, amount ] 
    };
}