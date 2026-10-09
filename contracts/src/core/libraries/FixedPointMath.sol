// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

library FixedPointMath {
    uint224 private constant Q112 = 2 ** 112;

    function encode(uint112 value) internal pure returns (uint224) {
        return uint224(value) * Q112;
    }

    function uqdiv(uint224 x, uint112 y) internal pure returns (uint224) {
        return x / uint224(y);
    }
}
