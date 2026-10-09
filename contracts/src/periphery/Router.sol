// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IFactory } from "./interfaces/IFactory.sol";
import { IPair } from "./interfaces/IPair.sol";
import { IERC20Minimal } from "../core/interfaces/IERC20Minimal.sol";
import { AmmLibrary } from "./libraries/AmmLibrary.sol";

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

contract Router {
    address public immutable factory;
    address public immutable wrappedNative;

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "Router: expired");
        _;
    }

    constructor(address factory_, address wrappedNative_) {
        factory = factory_;
        wrappedNative = wrappedNative_;
    }

    receive() external payable {
        assert(msg.sender == wrappedNative);
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    )
        internal
        returns (uint256 amountA, uint256 amountB)
    {
        if (IFactory(factory).getPair(tokenA, tokenB) == address(0)) {
            IFactory(factory).createPair(tokenA, tokenB);
        }

        (uint256 reserveA, uint256 reserveB) = AmmLibrary.getReserves(factory, tokenA, tokenB);

        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = AmmLibrary.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "Router: insufficient B amount");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = AmmLibrary.quote(amountBDesired, reserveB, reserveA);
                require(amountAOptimal <= amountADesired, "Router: excessive A amount");
                require(amountAOptimal >= amountAMin, "Router: insufficient A amount");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = AmmLibrary.pairFor(factory, tokenA, tokenB);
        _safeTransferFrom(tokenA, msg.sender, pair, amountA);
        _safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = IPair(pair).mint(to);
    }

    function addLiquidityNative(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountNativeMin,
        address to,
        uint256 deadline
    )
        external
        payable
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountNative, uint256 liquidity)
    {
        (amountToken, amountNative) = _addLiquidity(
            token,
            wrappedNative,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountNativeMin
        );

        address pair = AmmLibrary.pairFor(factory, token, wrappedNative);
        _safeTransferFrom(token, msg.sender, pair, amountToken);

        IWrappedNative(wrappedNative).deposit{ value: amountNative }();
        require(IERC20Minimal(wrappedNative).transfer(pair, amountNative), "Router: wrap transfer failed");

        liquidity = IPair(pair).mint(to);

        if (msg.value > amountNative) {
            _safeTransferNative(msg.sender, msg.value - amountNative);
        }
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        public
        ensure(deadline)
        returns (uint256 amountA, uint256 amountB)
    {
        address pair = AmmLibrary.pairFor(factory, tokenA, tokenB);
        IPair(pair).transferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IPair(pair).burn(to);
        (address token0, ) = AmmLibrary.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, "Router: insufficient A amount");
        require(amountB >= amountBMin, "Router: insufficient B amount");
    }

    function removeLiquidityNative(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountNativeMin,
        address to,
        uint256 deadline
    )
        public
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountNative)
    {
        (amountToken, amountNative) = removeLiquidity(
            token,
            wrappedNative,
            liquidity,
            amountTokenMin,
            amountNativeMin,
            address(this),
            deadline
        );
        _safeTransfer(token, to, amountToken);
        IWrappedNative(wrappedNative).withdraw(amountNative);
        _safeTransferNative(to, amountNative);
    }

    function _swap(uint256[] memory amounts, address[] memory path, address to) internal {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0, ) = AmmLibrary.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
            address recipient = i < path.length - 2 ? AmmLibrary.pairFor(factory, output, path[i + 2]) : to;
            IPair(AmmLibrary.pairFor(factory, input, output)).swap(amount0Out, amount1Out, recipient, new bytes(0));
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        amounts = AmmLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "Router: insufficient output amount");
        _safeTransferFrom(path[0], msg.sender, AmmLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactNativeForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        payable
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        require(path[0] == wrappedNative, "Router: invalid path");
        amounts = AmmLibrary.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "Router: insufficient output amount");

        IWrappedNative(wrappedNative).deposit{ value: amounts[0] }();
        require(
            IERC20Minimal(wrappedNative).transfer(AmmLibrary.pairFor(factory, path[0], path[1]), amounts[0]),
            "Router: wrap transfer failed"
        );
        _swap(amounts, path, to);
    }

    function swapExactTokensForNative(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        require(path[path.length - 1] == wrappedNative, "Router: invalid path");
        amounts = AmmLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "Router: insufficient output amount");
        _safeTransferFrom(path[0], msg.sender, AmmLibrary.pairFor(factory, path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IWrappedNative(wrappedNative).withdraw(amounts[amounts.length - 1]);
        _safeTransferNative(to, amounts[amounts.length - 1]);
    }

    function getAmountsOut(uint256 amountIn, address[] memory path) external view returns (uint256[] memory amounts) {
        return AmmLibrary.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint256 amountOut, address[] memory path) external view returns (uint256[] memory amounts) {
        return AmmLibrary.getAmountsIn(factory, amountOut, path);
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Router: transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Router: transferFrom failed");
    }

    function _safeTransferNative(address to, uint256 value) private {
        (bool success, ) = to.call{ value: value }("");
        require(success, "Router: native transfer failed");
    }
}
