// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "forge-std/interfaces/IERC20.sol";
import { Factory } from "../src/core/Factory.sol";
import { Pair, IPairCallee } from "../src/core/Pair.sol";
import { OmnikronToken } from "../src/tokens/OmnikronToken.sol";
import { AmmLibrary } from "../src/periphery/libraries/AmmLibrary.sol";
import { FixedPointMath } from "../src/core/libraries/FixedPointMath.sol";
import { MathUtils } from "../src/core/libraries/MathUtils.sol";

/// @dev Flash-swap callee used to exercise the `Pair.swap` -> `IPairCallee.onSwap` callback path.
contract PairCallee is IPairCallee {
    Pair internal immutable pair;
    uint256 internal immutable repayAmount;

    constructor(Pair pair_, uint256 repayAmount_) {
        pair = pair_;
        repayAmount = repayAmount_;
    }

    function onSwap(address sender, uint256 amount0Out, uint256 amount1Out, bytes calldata) external override {
        require(msg.sender == address(pair), "PairCallee: unauthorized");

        if (amount0Out > 0) {
            // Borrowed token0, must repay in token1.
            _repay(pair.token1());
            IERC20(pair.token0()).transfer(sender, amount0Out);
        } else {
            // Borrowed token1, must repay in token0.
            _repay(pair.token0());
            IERC20(pair.token1()).transfer(sender, amount1Out);
        }
    }

    function _repay(address token) private {
        uint256 amount = repayAmount == type(uint256).max ? IERC20(token).balanceOf(address(this)) : repayAmount;
        if (amount > 0) {
            IERC20(token).transfer(address(pair), amount);
        }
    }
}

contract PairTest is Test {
    uint256 internal constant INITIAL_LIQUIDITY = 10_000 ether;
    uint256 internal constant TOKEN_BALANCE = 100_000 ether;
    uint256 internal constant SWAP_AMOUNT_IN = 100 ether;
    uint256 internal constant REPAY_ALL = type(uint256).max;

    Factory internal factory;
    OmnikronToken internal omnikronToken2;
    OmnikronToken internal omnikronToken1;
    Pair internal pair;

    address internal deployer = address(this);
    address internal liquidityProvider;
    address internal swapper;
    address internal feeRecipient;

    function setUp() public {
        liquidityProvider = makeAddr("liquidityProvider");
        swapper = makeAddr("swapper");
        feeRecipient = makeAddr("feeRecipient");

        factory = new Factory(deployer, deployer);
        omnikronToken1 = new OmnikronToken(deployer);
        omnikronToken2 = new OmnikronToken(deployer);

        address pairAddress = factory.createPair(address(omnikronToken1), address(omnikronToken2));
        pair = Pair(pairAddress);

        omnikronToken1.transfer(liquidityProvider, TOKEN_BALANCE);
        omnikronToken2.transfer(liquidityProvider, TOKEN_BALANCE);
        omnikronToken1.transfer(swapper, 1_000 ether);
        omnikronToken2.transfer(swapper, 1_000 ether);
    }

    // ---------------------------------------------------------------- factory

    function test_FactoryRegistersPairInBothDirections() public view {
        assertEq(factory.getPair(address(omnikronToken1), address(omnikronToken2)), address(pair), "pair not registered");
        assertEq(
            factory.getPair(address(omnikronToken2), address(omnikronToken1)),
            address(pair),
            "reverse lookup mismatch"
        );
        assertEq(factory.allPairsLength(), 1, "unexpected pair count");
        assertEq(factory.allPairs(0), address(pair), "pair not indexed");
        assertEq(pair.factory(), address(factory), "factory not recorded on the pair");
    }

    function test_CreatePairSortsTokens() public view {
        address expectedToken0 = address(omnikronToken1) < address(omnikronToken2)
            ? address(omnikronToken1)
            : address(omnikronToken2);

        assertTrue(pair.token0() < pair.token1(), "tokens must be sorted ascending");
        assertEq(pair.token0(), expectedToken0, "wrong token0");
    }

    function test_CreatePairRevertsForIdenticalTokens() public {
        vm.expectRevert("Factory: identical addresses");
        factory.createPair(address(omnikronToken1), address(omnikronToken1));
    }

    function test_CreatePairRevertsForDuplicatePair() public {
        vm.expectRevert("Factory: pair exists");
        factory.createPair(address(omnikronToken2), address(omnikronToken1));
    }

    function test_CreatePairRevertsWhenPaused() public {
        factory.pause();
        assertTrue(factory.paused(), "factory should be paused");

        vm.expectRevert("Pausable: paused");
        factory.createPair(address(omnikronToken1), address(omnikronToken2));
    }

    function test_InitializeRevertsForNonFactoryCaller() public {
        Pair orphan = new Pair();

        vm.prank(swapper);
        vm.expectRevert("Pair: forbidden");
        orphan.initialize(address(omnikronToken1), address(omnikronToken2));
    }

    // -------------------------------------------------------------------- mint

    function test_MintCreatesInitialLiquidity() public {
        uint256 liquidity = _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        assertEq(liquidity, INITIAL_LIQUIDITY - pair.MINIMUM_LIQUIDITY(), "wrong initial liquidity");
        assertEq(pair.balanceOf(liquidityProvider), liquidity, "LP balance mismatch");
        assertEq(pair.balanceOf(address(0)), pair.MINIMUM_LIQUIDITY(), "minimum liquidity not locked");
        assertEq(pair.totalSupply(), INITIAL_LIQUIDITY, "total supply mismatch");

        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        assertEq(uint256(reserve0), INITIAL_LIQUIDITY, "reserve0 not synced");
        assertEq(uint256(reserve1), INITIAL_LIQUIDITY, "reserve1 not synced");
    }

    function test_MintIsProportionalForSubsequentDeposits() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        uint256 liquidity = _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        assertEq(liquidity, INITIAL_LIQUIDITY, "second deposit should mint proportionally");
        assertEq(pair.totalSupply(), 2 * INITIAL_LIQUIDITY, "total supply mismatch");
        assertEq(
            pair.balanceOf(liquidityProvider),
            2 * INITIAL_LIQUIDITY - pair.MINIMUM_LIQUIDITY(),
            "LP balance mismatch"
        );
    }

    function test_MintRevertsWhenNoLiquidityAdded() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        vm.expectRevert("Pair: insufficient liquidity minted");
        pair.mint(liquidityProvider);
    }

    // -------------------------------------------------------------------- burn

    function test_BurnReturnsProportionalLiquidity() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        bool token1IsToken0 = pair.token0() == address(omnikronToken1);
        uint256 token1Before = omnikronToken1.balanceOf(liquidityProvider);
        uint256 token2Before = omnikronToken2.balanceOf(liquidityProvider);
        uint256 lpBalance = pair.balanceOf(liquidityProvider);

        vm.startPrank(liquidityProvider);
        pair.transfer(address(pair), lpBalance);
        (uint256 amount0, uint256 amount1) = pair.burn(liquidityProvider);
        vm.stopPrank();

        uint256 expectedAmount = INITIAL_LIQUIDITY - pair.MINIMUM_LIQUIDITY();
        assertEq(amount0, expectedAmount, "wrong amount0 burned");
        assertEq(amount1, expectedAmount, "wrong amount1 burned");
        assertEq(
            omnikronToken1.balanceOf(liquidityProvider) - token1Before,
            token1IsToken0 ? amount0 : amount1,
            "token1 not returned"
        );
        assertEq(
            omnikronToken2.balanceOf(liquidityProvider) - token2Before,
            token1IsToken0 ? amount1 : amount0,
            "token2 not returned"
        );
        assertEq(pair.balanceOf(liquidityProvider), 0, "LP tokens not burned");
        assertEq(pair.totalSupply(), pair.MINIMUM_LIQUIDITY(), "minimum liquidity should stay locked");

        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        assertEq(uint256(reserve0), pair.MINIMUM_LIQUIDITY(), "reserve0 not synced after burn");
        assertEq(uint256(reserve1), pair.MINIMUM_LIQUIDITY(), "reserve1 not synced after burn");
    }

    function test_BurnRevertsWithoutLiquidity() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        vm.expectRevert("Pair: insufficient liquidity burned");
        pair.burn(liquidityProvider);
    }

    // -------------------------------------------------------------------- swap

    function test_SwapRespectsConstantProduct() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        address tokenIn = address(omnikronToken2);
        address tokenOut = tokenIn == pair.token0() ? pair.token1() : pair.token0();

        (uint256 reserveInBefore, uint256 reserveOutBefore) = _reservesFor(tokenIn);
        uint256 balanceOutBefore = IERC20(tokenOut).balanceOf(swapper);

        uint256 amountOut = _swapExactIn(tokenIn, SWAP_AMOUNT_IN, swapper);

        assertGt(amountOut, 0, "swap produced no output");
        assertEq(
            IERC20(tokenOut).balanceOf(swapper) - balanceOutBefore,
            amountOut,
            "output token not delivered to swapper"
        );
        assertEq(
            amountOut,
            AmmLibrary.getAmountOut(SWAP_AMOUNT_IN, reserveInBefore, reserveOutBefore),
            "output must follow the constant product formula"
        );

        (uint256 reserveInAfter, uint256 reserveOutAfter) = _reservesFor(tokenIn);
        assertEq(reserveInAfter, reserveInBefore + SWAP_AMOUNT_IN, "input reserve not updated");
        assertEq(reserveOutAfter, reserveOutBefore - amountOut, "output reserve not updated");
        assertEq(IERC20(tokenIn).balanceOf(address(pair)), reserveInAfter, "pair did not retain the input token");
        assertGt(reserveInAfter * reserveOutAfter, reserveInBefore * reserveOutBefore, "k must grow with every swap");
    }

    function test_SwapChargesFeeOnInput() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        (uint256 reserveIn, uint256 reserveOut) = _reservesFor(address(omnikronToken2));
        uint256 spotOut = AmmLibrary.quote(SWAP_AMOUNT_IN, reserveIn, reserveOut);

        uint256 amountOut = _swapExactIn(address(omnikronToken2), SWAP_AMOUNT_IN, swapper);

        assertLt(amountOut, spotOut, "swap must return less than the spot quote because of the fee");

        // AmmLibrary hardcodes the matching 0.30% fee. If SWAP_FEE_BPS ever changes, the output
        // predicted by the library stops matching what the pair accepts (the swap reverts with "Pair: K").
        assertEq(pair.SWAP_FEE_BPS(), 30, "swap fee changed: realign AmmLibrary and this test");
    }

    function test_SwapRevertsWithoutOutputRequest() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        vm.expectRevert("Pair: insufficient output amount");
        pair.swap(0, 0, swapper, "");
    }

    function test_SwapRevertsWhenOutputExceedsReserves() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();

        vm.expectRevert("Pair: insufficient liquidity");
        pair.swap(uint256(reserve0), uint256(reserve1) / 2, swapper, "");
    }

    function test_SwapRevertsWithoutInputAmount() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);
        (, uint112 reserve1,) = pair.getReserves();

        vm.expectRevert("Pair: insufficient input amount");
        pair.swap(0, uint256(reserve1) / 10, swapper, "");
    }

    function test_SwapRevertsForTokenRecipient() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);
        (, uint112 reserve1,) = pair.getReserves();
        address token1 = pair.token1();

        vm.expectRevert("Pair: invalid recipient");
        pair.swap(0, uint256(reserve1) / 10, token1, "");
    }

    function test_SwapAccumulatesPriceCumulative() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        (uint112 reserve0Before, uint112 reserve1Before, uint32 lastTimestampBefore) = pair.getReserves();
        uint256 price0 = uint256(FixedPointMath.uqdiv(FixedPointMath.encode(reserve1Before), reserve0Before));
        uint256 price1 = uint256(FixedPointMath.uqdiv(FixedPointMath.encode(reserve0Before), reserve1Before));

        vm.warp(block.timestamp + 1 hours);
        _swapExactIn(address(omnikronToken2), SWAP_AMOUNT_IN, swapper);

        (, , uint32 lastTimestampAfter) = pair.getReserves();
        uint256 elapsed = uint256(lastTimestampAfter) - uint256(lastTimestampBefore);
        assertGt(elapsed, 0, "time must elapse for the accumulator to move");

        assertEq(pair.price0CumulativeLast(), price0 * elapsed, "price0 cumulative mismatch");
        assertEq(pair.price1CumulativeLast(), price1 * elapsed, "price1 cumulative mismatch");
    }

    // -------------------------------------------------------------- flash swap

    function test_FlashSwapCallbackRepaysAndSucceeds() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        PairCallee callee = new PairCallee(pair, REPAY_ALL);
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        uint256 amountOut = AmmLibrary.getAmountOut(SWAP_AMOUNT_IN, uint256(reserve0), uint256(reserve1));

        IERC20(pair.token0()).transfer(address(callee), SWAP_AMOUNT_IN); // repayment float
        uint256 borrowedBefore = IERC20(pair.token1()).balanceOf(address(this));

        pair.swap(0, amountOut, address(callee), abi.encode("flash"));

        assertEq(
            IERC20(pair.token1()).balanceOf(address(this)) - borrowedBefore,
            amountOut,
            "borrowed token1 not received"
        );

        (uint112 reserve0After, uint112 reserve1After,) = pair.getReserves();
        assertEq(uint256(reserve0After), uint256(reserve0) + SWAP_AMOUNT_IN, "reserve0 not updated by the flash swap");
        assertEq(uint256(reserve1After), uint256(reserve1) - amountOut, "reserve1 not updated by the flash swap");
    }

    function test_FlashSwapRevertsWithoutRepayment() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        PairCallee callee = new PairCallee(pair, 0);
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        uint256 amountOut = AmmLibrary.getAmountOut(SWAP_AMOUNT_IN, uint256(reserve0), uint256(reserve1));

        vm.expectRevert("Pair: insufficient input amount");
        pair.swap(0, amountOut, address(callee), abi.encode("flash"));
    }

    function test_FlashSwapRevertsWhenRepaymentIsTooSmall() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        PairCallee callee = new PairCallee(pair, 1);
        IERC20(pair.token0()).transfer(address(callee), SWAP_AMOUNT_IN);

        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        uint256 amountOut = AmmLibrary.getAmountOut(SWAP_AMOUNT_IN, uint256(reserve0), uint256(reserve1));

        vm.expectRevert("Pair: K");
        pair.swap(0, amountOut, address(callee), abi.encode("flash"));
    }

    // ------------------------------------------------------------- sync & skim

    function test_SyncUpdatesReservesAfterDirectTransfer() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        uint256 donated = 500 ether;
        omnikronToken1.transfer(address(pair), donated);
        omnikronToken2.transfer(address(pair), donated);

        (uint112 reserve0Before, uint112 reserve1Before,) = pair.getReserves();
        assertEq(uint256(reserve0Before), INITIAL_LIQUIDITY, "reserves must not move before sync");
        assertEq(uint256(reserve1Before), INITIAL_LIQUIDITY, "reserves must not move before sync");

        pair.sync();

        (uint112 reserve0After, uint112 reserve1After,) = pair.getReserves();
        assertEq(uint256(reserve0After), INITIAL_LIQUIDITY + donated, "reserve0 not synced");
        assertEq(uint256(reserve1After), INITIAL_LIQUIDITY + donated, "reserve1 not synced");
    }

    function test_SkimReturnsExcessTokensWithoutMovingReserves() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        uint256 donated = 500 ether;
        omnikronToken1.transfer(address(pair), donated);
        omnikronToken2.transfer(address(pair), donated);

        address recipient = makeAddr("skimRecipient");
        pair.skim(recipient);

        assertEq(omnikronToken1.balanceOf(recipient), donated, "excess token1 not skimmed");
        assertEq(omnikronToken2.balanceOf(recipient), donated, "excess token2 not skimmed");

        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        assertEq(uint256(reserve0), INITIAL_LIQUIDITY, "reserves must not change on skim");
        assertEq(uint256(reserve1), INITIAL_LIQUIDITY, "reserves must not change on skim");
    }

    // ------------------------------------------------------------ protocol fee

    function test_MintFeeMintsProtocolFeeToRecipient() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        factory.setFeeRecipient(feeRecipient);
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY); // seeds kLast, no fee due yet

        uint256 kLastBefore = pair.kLast();
        assertGt(kLastBefore, 0, "kLast must be seeded while the fee is active");

        _swapExactIn(address(omnikronToken2), SWAP_AMOUNT_IN, swapper);

        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        uint256 rootK = MathUtils.sqrt(uint256(reserve0) * reserve1);
        uint256 rootKLast = MathUtils.sqrt(kLastBefore);
        uint256 totalSupplyBefore = pair.totalSupply();
        uint256 expectedFee = (totalSupplyBefore * (rootK - rootKLast)) / ((rootK * 3) + rootKLast);
        assertGt(expectedFee, 0, "expected a non-zero protocol fee");

        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        assertEq(pair.balanceOf(feeRecipient), expectedFee, "protocol fee not minted to the fee recipient");

        (uint112 reserve0After, uint112 reserve1After,) = pair.getReserves();
        assertEq(pair.kLast(), uint256(reserve0After) * reserve1After, "kLast not updated after mint");
    }

    // ---------------------------------------------------------------- LP token

    function test_LpTokenTransferAndAllowance() public {
        _addLiquidity(liquidityProvider, INITIAL_LIQUIDITY);

        uint256 lpBalance = pair.balanceOf(liquidityProvider);

        vm.prank(liquidityProvider);
        assertTrue(pair.transfer(swapper, 1 ether), "LP transfer failed");

        assertEq(pair.balanceOf(swapper), 1 ether, "recipient LP balance mismatch");
        assertEq(pair.balanceOf(liquidityProvider), lpBalance - 1 ether, "sender LP balance mismatch");

        vm.prank(liquidityProvider);
        pair.approve(deployer, type(uint256).max);
        pair.transferFrom(liquidityProvider, swapper, 2 ether);
        assertEq(
            pair.allowance(liquidityProvider, deployer),
            type(uint256).max,
            "infinite allowance must be preserved"
        );

        vm.prank(liquidityProvider);
        pair.approve(deployer, 1 ether);
        pair.transferFrom(liquidityProvider, swapper, 1 ether);
        assertEq(pair.allowance(liquidityProvider, deployer), 0, "allowance must be decremented");
    }

    // ----------------------------------------------------------------- helpers

    function _addLiquidity(address provider, uint256 amount) internal returns (uint256 liquidity) {
        vm.startPrank(provider);
        omnikronToken1.transfer(address(pair), amount);
        omnikronToken2.transfer(address(pair), amount);
        liquidity = pair.mint(provider);
        vm.stopPrank();
    }

    /// @dev Swaps `amountIn` of `tokenIn` for the output predicted by `AmmLibrary.getAmountOut`. The
    ///      expected amount deliberately comes from the periphery library: if its hardcoded fee ever
    ///      diverges from `Pair.SWAP_FEE_BPS`, the pair rejects the swap with "Pair: K" and this fails loudly.
    function _swapExactIn(address tokenIn, uint256 amountIn, address to) internal returns (uint256 amountOut) {
        (uint256 reserveIn, uint256 reserveOut) = _reservesFor(tokenIn);
        amountOut = AmmLibrary.getAmountOut(amountIn, reserveIn, reserveOut);

        vm.startPrank(swapper);
        IERC20(tokenIn).transfer(address(pair), amountIn);
        if (pair.token0() == tokenIn) {
            pair.swap(0, amountOut, to, "");
        } else {
            pair.swap(amountOut, 0, to, "");
        }
        vm.stopPrank();
    }

    function _reservesFor(address token) internal view returns (uint256 reserveIn, uint256 reserveOut) {
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        (reserveIn, reserveOut) = pair.token0() == token
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));
    }
}
