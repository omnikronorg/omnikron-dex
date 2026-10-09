// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

interface IPair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 lastBlockTimestamp);
    function mint(address to) external returns (uint256 liquidity);
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}
