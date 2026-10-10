// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice WETH minimal (WETH9-like) for local development (Anvil) and tests.
/// @dev Implements deposit() payable / withdraw(uint256) — same interface expected by the Router.
contract MockWNative is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{ value: amount }("");
        require(ok, "MockWNative: native transfer failed");
    }
}
