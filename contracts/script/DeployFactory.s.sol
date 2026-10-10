// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { Script, console2 } from "forge-std/Script.sol";
import { Factory } from "../src/core/Factory.sol";
import { JsonUtils } from "./lib/JsonUtils.sol";

contract DeployFactory is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        string memory path = _deploymentPath();

        if (!vm.exists(path)) {
            vm.writeFile(path, "{}");
        }

        vm.startBroadcast(deployerPrivateKey);
        Factory factory = new Factory(deployer, deployer); // feeSetter e guardian = deployer por enquanto
        vm.stopBroadcast();

        vm.writeJson(JsonUtils.quote(vm.toString(address(factory))), path, ".factory");

        console2.log("Factory:", address(factory));
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), ".json");
    }
}
