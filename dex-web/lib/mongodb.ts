// SERVER-ONLY MODULE — do not import from any Client Component.
// The MongoDB driver depends on Node.js built-ins (e.g. child_process) that
// do not exist in the browser. Importing this from client code breaks the
// bundle with "Can't resolve 'child_process'". Keep all Mongo access on the
// server (dataLoaders.server.ts, syncAmm.ts, seedTokens.ts).
import { MongoClient, MongoClientOptions } from 'mongodb';

if (!process.env.MONGODB_URI)
{
    throw new Error('Missing MONGODB_URI in your environment (.env.local)');
}

const uri = process.env.MONGODB_URI;
const options: MongoClientOptions = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

declare global {
    // eslint-disable-next-line no-var
    var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (process.env.NODE_ENV === 'development') 
{
    // In dev, Next.js hot-reloads modules, which would otherwise open a new
    // connection on every save. Cache the promise on the global object instead.
    if (!global._mongoClientPromise) 
    {
        client = new MongoClient(uri, options);
        global._mongoClientPromise = client.connect();
    }

    clientPromise = global._mongoClientPromise;
} 
else 
{
    // In production, no global caching needed — one client per instance.
    client = new MongoClient(uri, options);
    clientPromise = client.connect();
}

// Export a single shared promise so every helper reuses the same connection.
export default clientPromise;
