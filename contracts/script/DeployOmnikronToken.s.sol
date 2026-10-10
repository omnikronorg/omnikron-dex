// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { Script, console2 } from "forge-std/Script.sol";
import { OmnikronToken } from "../src/tokens/OmnikronToken.sol";
import { JsonUtils } from "./lib/JsonUtils.sol";

contract DeployOmnikronToken is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        string memory path = _deploymentPath();

        if (!vm.exists(path)) {
            vm.writeFile(path, "{}");
        }

        vm.startBroadcast(deployerPrivateKey);
        OmnikronToken omnikronToken = new OmnikronToken(deployer);
        vm.stopBroadcast();

        vm.writeJson(JsonUtils.quote(vm.toString(address(omnikronToken))), path, ".omnikronToken");

        console2.log("OmnikronToken:", address(omnikronToken));
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), ".json");
    }
}
