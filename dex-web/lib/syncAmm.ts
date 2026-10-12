import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { MongoHelper } from '@/lib/mongoHelper';
import { Amm } from '@/models/amm';

const ammCollectionName = 'amm';

export async function syncAmmFromDeployments(deploymentsDir?: string): Promise<void>
{
    const dir = deploymentsDir ?? resolve(process.cwd(), '../contracts/deployments');
    const amm = new MongoHelper<Amm>(ammCollectionName);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

    const seen = new Set<number>();
    for (const file of files)
    {
        const chainId = Number(basename(file, '.json'));
        if (!Number.isInteger(chainId))
        {
            continue;
        }

        const json = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, string>;
        const doc: Amm = {
            chainId,
            platformToken: json.omnikronToken,
            factory: json.factory,
            wrappedNative: json.wrappedNative,
            router: json.router,
        };
        seen.add(chainId);

        const existing = await amm.findOne({ chainId });
        if (!existing)
        {
            console.log(`[syncAmmFromDeployments] [Insert] Processing ${file} for chainId ${chainId}`);
            await amm.insertOne(doc);
            continue;
        }

        const changed =
            existing.platformToken !== doc.platformToken ||
            existing.factory !== doc.factory ||
            existing.wrappedNative !== doc.wrappedNative ||
            existing.router !== doc.router;

        if (changed)
        {
            console.log(`[syncAmmFromDeployments] [Update] Processing ${file} for chainId ${chainId}`);

            await amm.updateOne(
                { chainId },
                { $set: {
                    platformToken: doc.platformToken,
                    factory: doc.factory,
                    wrappedNative: doc.wrappedNative,
                    router: doc.router,
                } },
            );
        }
    }

    // Cleanup: drop AMM docs whose chain no longer has a deployment file
    const all = await amm.findMany({});
    for (const row of all)
    {
        if (!seen.has(row.chainId))
        {
            console.log(`[syncAmmFromDeployments] [Delete] Processing for chainId ${row.chainId}`);
            await amm.deleteOne({ _id: row._id });
        }
    }
}
