import type { ObjectId } from 'mongodb';

export interface Amm {
    _id?: ObjectId;
    chainId: number;
    chainName: string;
    chainLogoURI: string;
    platformToken: string;
    factory: string;
    wrappedNative: string;
    router: string;
}
