import { MongoHelper } from "@/lib/mongoHelper";
import { Amm } from "@/models/amm";

export interface ChainConfig {
    chainId: number;
    wrappedNative: string;
    platformToken: string;
    factory: string;
    router: string;
}

const ammCollectionName = 'amm';

export async function getChainConfig(chainId: number | undefined): Promise<ChainConfig | null>
{
    if (!chainId)
    {
        return null;
    }

    const amm = new MongoHelper<Amm>(ammCollectionName);

    const chain = await amm.findOne({ chainId: chainId });

    if(!chain)
    {
        return null;
    }

    const result : ChainConfig = {
        chainId: chain.chainId,
        wrappedNative: chain.wrappedNative,
        platformToken: chain.platformToken,
        factory: chain.factory,
        router: chain.router
    }

    return result;
}
