// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { Vm } from "forge-std/Vm.sol";

library BroadcastUtils {
    // Se PRIVATE_KEY estiver definida no ambiente, assina com ela (modo simples, usado até aqui na testnet).
    // Se PRIVATE_KEY estiver ausente, assume modo keystore: lê DEPLOYER_ADDRESS e deixa a assinatura
    // por conta da flag --account (ou --ledger/--trezor) passada na linha de comando do forge script.
    function startBroadcastFlexible(Vm vmInstance) internal returns (address deployer) {
        uint256 deployerPrivateKey = vmInstance.envOr("PRIVATE_KEY", uint256(0));

        if (deployerPrivateKey != 0) {
            deployer = vmInstance.addr(deployerPrivateKey);
            vmInstance.startBroadcast(deployerPrivateKey);
        } else {
            deployer = vmInstance.envAddress("DEPLOYER_ADDRESS");
            vmInstance.startBroadcast();
        }
    }
}
