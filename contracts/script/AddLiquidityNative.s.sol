// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "forge-std/interfaces/IERC20.sol";
import { IFactory } from "../src/periphery/interfaces/IFactory.sol";
import { Router } from "../src/periphery/Router.sol";

/// @notice Adiciona liquidez NATIVO x ERC-20 (OMNIKRON) na rede local/testnet.
/// @dev Espera, via .env (exportadas pelo add-liquidity-anvil.sh):
///      PRIVATE_KEY, LIQUIDITY_TOKEN_ADDRESS, LIQUIDITY_TOKEN (unidades), LIQUIDITY_NATIVE (wei).
///      Lê factory/router/wrappedNative de deployments/<chainId>.json.
///      A lógica é dividida em funções internas com escopo próprio para evitar
///      "stack too deep" no codegen legado do solc 0.8.36.
contract AddLiquidityNative is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        string memory json = _readDeploymentJson();
        address factory = vm.parseJsonAddress(json, ".factory");
        address routerAddr = vm.parseJsonAddress(json, ".router");
        address wrapped = vm.parseJsonAddress(json, ".wrappedNative");
        require(factory != address(0), "AddLiquidityNative: factory missing in json");

        address token = vm.envAddress("LIQUIDITY_TOKEN_ADDRESS");
        uint256 amountToken = vm.envUint("LIQUIDITY_TOKEN");
        uint256 amountNative = vm.envUint("LIQUIDITY_NATIVE");
        require(token != address(0) && amountToken > 0 && amountNative > 0, "AddLiquidityNative: bad env");

        // 1) Cria o par se ainda não existir (Router NAO cria).
        _ensurePair(pk, factory, token, wrapped);

        // 2) Aprova o Router a mover os tokens.
        _ensureAllowance(pk, token, deployer, routerAddr, amountToken);

        // 3) Adiciona liquidez nativo x token.
        _addLiquidity(pk, routerAddr, token, deployer, amountToken, amountNative);
    }

    function _readDeploymentJson() internal view returns (string memory) {
        return vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    function _ensurePair(uint256 pk, address factory, address token, address wrapped) internal {
        if (IFactory(factory).getPair(token, wrapped) != address(0)) return;

        vm.startBroadcast(pk);
        IFactory(factory).createPair(token, wrapped);
        vm.stopBroadcast();

        console2.log("Pair criado:", IFactory(factory).getPair(token, wrapped));
    }

    function _ensureAllowance(uint256 pk, address token, address deployer, address routerAddr, uint256 amountToken)
        internal
    {
        if (IERC20(token).allowance(deployer, routerAddr) >= amountToken) return;

        vm.startBroadcast(pk);
        IERC20(token).approve(routerAddr, amountToken);
        vm.stopBroadcast();
    }

    function _addLiquidity(
        uint256 pk,
        address routerAddr,
        address token,
        address deployer,
        uint256 amountToken,
        uint256 amountNative
    ) internal {
        vm.startBroadcast(pk);
        (uint256 usedToken, uint256 usedNative, uint256 liquidity) = Router(payable(routerAddr))
            .addLiquidityNative{ value: amountNative }(
                token,
                amountToken, // amountTokenDesired
                0, // amountTokenMin (slippage aberto no local)
                0, // amountNativeMin
                deployer, // to (recebe os LP tokens)
                block.timestamp + 1 hours
            );
        vm.stopBroadcast();

        console2.log("token usado:", usedToken);
        console2.log("nativo usado:", usedNative);
        console2.log("liquidity LP:", liquidity);
    }
}
