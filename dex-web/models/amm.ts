import { ObjectId } from 'mongodb';

export interface Amm {
    _id?: ObjectId;
    chainId: number;
    platformToken: string;
    factory: string;
    wrappedNative: string;
    router: string;
}
