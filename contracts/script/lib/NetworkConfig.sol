// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice Endereços canônicos do token nativo embrulhado (WETH/WBNB/WPOL/WAVAX) por chainId.
/// @dev Use WRAPPED_NATIVE no .env para sobrescrever (ex.: Anvil, fork, rede não listada).
library NetworkConfig {
    function wrappedNative(uint256 chainId) internal pure returns (address) {
        // ---- Mainnets ----
        if (chainId == 1) return 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // Ethereum: WETH
        if (chainId == 56) return 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c; // BNB: WBNB
        if (chainId == 137) return 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270; // Polygon: WPOL (ex-WMATIC)
        if (chainId == 42161) return 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1; // Arbitrum One: WETH
        if (chainId == 10) return 0x4200000000000000000000000000000000000006; // Optimism: WETH
        if (chainId == 8453) return 0x4200000000000000000000000000000000000006; // Base: WETH
        if (chainId == 43114) return 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7; // Avalanche: WAVAX

        // ---- Testnets ----
        if (chainId == 11155111) return 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14; // Sepolia: WETH
        if (chainId == 97) return 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd; // BSC Testnet: WBNB
        if (chainId == 80002) return 0x52eF3d68BaB452a294342DC3e5f464d7f610f72E; // Amoy: PoS-WETH (bridged)
        if (chainId == 43113) return 0xd00ae08403B9bbb9124bB305C09058E32C39A48c; // Fuji: WAVAX
        if (chainId == 11155420) return 0x4200000000000000000000000000000000000006; // OP Sepolia: WETH (padrão OP Stack)
        if (chainId == 84532) return 0x4200000000000000000000000000000000000006; // Base Sepolia: WETH (padrão OP Stack)

        return address(0); // desconhecido/local → caller decide (mock ou .env)
    }
}
