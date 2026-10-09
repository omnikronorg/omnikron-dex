// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract OmnikronToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    constructor(address initialHolder) ERC20("Omnikron Token", "OMNIKRON") Ownable(msg.sender) {
        _mint(initialHolder, MAX_SUPPLY);
    }
}
