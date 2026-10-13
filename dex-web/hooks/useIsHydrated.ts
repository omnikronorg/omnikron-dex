"use client"

import { useSyncExternalStore } from "react";

// Nao ha store externa: o objetivo e so distinguir "servidor/1o render de hidratacao" (false)
// de "cliente ja hidratado" (true). Booleano primitivo, entao o getServerSnapshot e cacheavel.
const subscribe = () => () => {};

export function useIsHydrated()
{
    return useSyncExternalStore(subscribe, () => true, () => false);
}
