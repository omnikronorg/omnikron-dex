import { ObjectId } from 'mongodb';

export interface Token {
    _id?: ObjectId;
    chainId: number;
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string;
    isNative?: boolean;
}
