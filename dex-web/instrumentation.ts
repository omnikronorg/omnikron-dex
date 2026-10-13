/**
 * Boot hook called once when a new Next.js server instance is initiated,
 * before the server is ready to handle requests. Synchronizes the "amm"
 * collection from the deployment JSON files in ../contracts/deployments.
 *
 * Runs only in the Node.js runtime and never during the production build, so
 * it is safe for local/self-hosted deployments. Any failure is logged and
 * swallowed so it can never prevent the server from booting.
 */
export async function register(): Promise<void>
{
    // Skip on the Edge runtime: we rely on Node's fs to read deployment files.
    if(process.env.NEXT_RUNTIME !== 'nodejs')
    {
        return;
    }

    if(process.env.NEXT_PHASE === 'phase-production-build')
    {
        return;
    }

    // Dynamic import: only for nodejs bundle, never in edge (avoid node:fs in Edge)
    const { syncAmmFromDeployments } = await import('@/lib/syncAmm');
    const { seedTokensIfEmpty } = await import('./lib/seedTokens');
    const { loadNetworkList, loadTokenList, loadChainConfigList } = await import('./lib/dataLoaders.server');


    // Skip while building: writing to the database during `next build` is
    // undesirable and the deployments directory may not be present.
    if(process.env.NEXT_PHASE === 'phase-production-build')
    {
        return;
    }

    try
    {
        await syncAmmFromDeployments();

        await seedTokensIfEmpty();

        // Preload the full token list into the in-memory cache so requests
        // reuse it without querying MongoDB on every call.
        await loadTokenList();

        await loadNetworkList();
        await loadChainConfigList();

    }
    catch(error)
    {
        // Never throw from register(): it must complete before the server
        // accepts requests, so a sync failure must not block startup.
        console.error('[instrumentation] Failed to sync AMM deployments:', error);
    }
}
