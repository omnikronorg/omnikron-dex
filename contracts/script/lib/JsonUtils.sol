// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

library JsonUtils {
    // vm.writeJson espera um valor já em formato JSON válido.
    // Um endereço/string precisa vir entre aspas; um número, não.
    function quote(string memory value) internal pure returns (string memory) {
        return string.concat('"', value, '"');
    }
}
