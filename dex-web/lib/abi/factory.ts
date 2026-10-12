export const factoryAbi = [
    {
        type: "function",
        name: "getPair",
        stateMutability: "view",
        inputs: [
            { name: "tokenA", type: "address" },
            { name: "tokenB", type: "address" },
        ],
        outputs: [{ name: "pair", type: "address" }],
    },
    {
        type: "function",
        name: "allPairsLength",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "allPairs",
        stateMutability: "view",
        inputs: [{ name: "index", type: "uint256" }],
        outputs: [{ name: "", type: "address" }],
    },
] as const;
