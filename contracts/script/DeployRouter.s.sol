// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { Script, console2 } from "forge-std/Script.sol";
import { Router } from "../src/periphery/Router.sol";
import { NetworkConfig } from "./lib/NetworkConfig.sol";
import { MockWNative } from "./mocks/MockWNative.sol";
import { JsonUtils } from "./lib/JsonUtils.sol";

contract DeployRouter is Script {
    uint256 internal constant ANVIL_CHAIN_ID = 31337;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        string memory path = _deploymentPath();

        if (!vm.exists(path)) {
            vm.writeFile(path, "{}");
        }
        string memory existingJson = vm.readFile(path);
        address factory = vm.parseJsonAddress(existingJson, ".factory");
        require(factory != address(0), "DeployRouter: factory missing in deployments/<chainId>.json");

        address wrappedNative = _resolveWrappedNative(existingJson, path);

        vm.startBroadcast(deployerPrivateKey);
        Router router = new Router(factory, wrappedNative);
        vm.stopBroadcast();

        vm.writeJson(JsonUtils.quote(vm.toString(address(router))), path, ".router");
        vm.writeJson(JsonUtils.quote(vm.toString(wrappedNative)), path, ".wrappedNative");

        console2.log("WrappedNative:", wrappedNative);
        console2.log("Router:", address(router));
    }

    /// @dev Prioridade: override .env > valor já deployado no JSON > mapa NetworkConfig > mock (só em chain local).
    function _resolveWrappedNative(string memory existingJson, string memory path)
        internal
        returns (address wrappedNative)
    {
        // 1) Explicit override via .env (it ignores empty string).
        string memory overrideStr = vm.envOr("WRAPPED_NATIVE", string(""));
        if (bytes(overrideStr).length != 0) {
            wrappedNative = vm.parseAddress(overrideStr);
        }

        // 2) Reuse an address already registered by a previous deploy in this network.
        if (wrappedNative == address(0) && vm.keyExistsJson(existingJson, ".wrappedNative")) {
            wrappedNative = vm.parseJsonAddress(existingJson, ".wrappedNative");
        }

        // 3) Canonical map by chainId.
        if (wrappedNative == address(0)) {
            wrappedNative = NetworkConfig.wrappedNative(block.chainid);
        }

        // 4) Local chain (Anvil/Hardhat) without known address: make deploy from a MockWNative.
        if (wrappedNative == address(0) && (block.chainid == ANVIL_CHAIN_ID || block.chainid == 1337)) {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
            wrappedNative = address(new MockWNative("Wrapped Native", "WNATIVE"));
            vm.stopBroadcast();
            console2.log("MockWNative deployado:", wrappedNative);
        }

        require(wrappedNative != address(0), "DeployRouter: define WRAPPED_NATIVE into .env for this network");
        vm.writeJson(JsonUtils.quote(vm.toString(wrappedNative)), path, ".wrappedNative");
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), ".json");
    }
}
