import {
    Collection,
    Document,
    Filter,
    FindOptions,
    InsertManyResult,
    InsertOneResult,
    OptionalUnlessRequiredId,
    UpdateFilter,
    UpdateResult,
    DeleteResult,
    WithId,
} from 'mongodb';
import clientPromise from './mongodb';

/**
 * Generic CRUD helper for a single MongoDB collection.
 *
 * Usage:
 *   const users = new MongoHelper<User>('users');
 *   await users.insertOne({ name: 'Ada', email: 'ada@example.com' });
 */
export class MongoHelper<T extends Document = Document> 
{
    private collectionName: string;
    private dbName?: string;

    /**
     * @param collectionName Name of the MongoDB collection
     * @param dbName Optional database name. If omitted, uses the default
     *   database from your MONGODB_URI connection string.
     */
    constructor(collectionName: string, dbName?: string) 
    {
        this.collectionName = collectionName;
        this.dbName = dbName;
    }

    private async getCollection(): Promise<Collection<T>> 
    {
        const client = await clientPromise;
        const db = this.dbName ? client.db(this.dbName) : client.db();
        return db.collection<T>(this.collectionName);
    }

    // ---------------------------------------------------------------------
    // INSERT
    // ---------------------------------------------------------------------
    async insertOne(doc: OptionalUnlessRequiredId<T>): Promise<InsertOneResult<T>> 
    {
        const collection = await this.getCollection();
        return collection.insertOne(doc);
    }

    async insertMany(docs: OptionalUnlessRequiredId<T>[]): Promise<InsertManyResult<T>> 
    {
        const collection = await this.getCollection();
        return collection.insertMany(docs);
    }

    // ---------------------------------------------------------------------
    // FIND (included since you'll typically need it alongside write ops)
    // ---------------------------------------------------------------------
    async findOne(filter: Filter<T> = {}, options?: FindOptions): Promise<WithId<T> | null> 
    {
        const collection = await this.getCollection();
        return collection.findOne(filter, options);
    }

    async findMany(filter: Filter<T> = {}, options?: FindOptions): Promise<WithId<T>[]> 
    {
        const collection = await this.getCollection();
        return collection.find(filter, options).toArray();
    }

    // ---------------------------------------------------------------------
    // UPDATE
    // ---------------------------------------------------------------------
    async updateOne(filter: Filter<T>, update: UpdateFilter<T>, upsert = false): Promise<UpdateResult<T>> 
    {
        const collection = await this.getCollection();
        return collection.updateOne(filter, update, { upsert });
    }

    async updateMany(filter: Filter<T>, update: UpdateFilter<T>, upsert = false): Promise<UpdateResult<T>> 
    {
        const collection = await this.getCollection();
        return collection.updateMany(filter, update, { upsert });
    }

    // ---------------------------------------------------------------------
    // DELETE
    // ---------------------------------------------------------------------
    async deleteOne(filter: Filter<T>): Promise<DeleteResult> 
    {
        const collection = await this.getCollection();
        return collection.deleteOne(filter);
    }

    async deleteMany(filter: Filter<T>): Promise<DeleteResult> 
    {
        const collection = await this.getCollection();
        return collection.deleteMany(filter);
    }
}
