// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { IERC20Minimal } from "./interfaces/IERC20Minimal.sol";
import { FixedPointMath } from "./libraries/FixedPointMath.sol";
import { MathUtils } from "./libraries/MathUtils.sol";

interface IPairCallee {
    function onSwap(address sender, uint256 amount0Out, uint256 amount1Out, bytes calldata data) external;
}

interface IFactoryFee {
    function feeRecipient() external view returns (address);
}

contract Pair {
    using FixedPointMath for uint224;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant SWAP_FEE_BPS = 30; // 0.30%

    address public factory;
    address public token0;
    address public token1;

    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32 private _lastBlockTimestamp;

    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    uint256 public kLast;

    string public constant name = "AMM LP Token";
    string public constant symbol = "AMM-LP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 private _locked = 1;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    modifier lock() {
        require(_locked == 1, "Pair: locked");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor() {
        factory = msg.sender;
    }

    function initialize(address token0_, address token1_) external {
        require(msg.sender == factory, "Pair: forbidden");
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() public view returns (uint112 reserve0, uint112 reserve1, uint32 lastBlockTimestamp) {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        lastBlockTimestamp = _lastBlockTimestamp;
    }

    function _update(uint256 balance0, uint256 balance1, uint112 reserve0Old, uint112 reserve1Old) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "Pair: overflow");

        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);

        unchecked {
            uint32 timeElapsed = blockTimestamp - _lastBlockTimestamp;
            if (timeElapsed > 0 && reserve0Old != 0 && reserve1Old != 0) {
                price0CumulativeLast += uint256(FixedPointMath.encode(reserve1Old).uqdiv(reserve0Old)) * timeElapsed;
                price1CumulativeLast += uint256(FixedPointMath.encode(reserve0Old).uqdiv(reserve1Old)) * timeElapsed;
            }
        }

        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
        _lastBlockTimestamp = blockTimestamp;

        emit Sync(_reserve0, _reserve1);
    }

    function _mintFee(uint112 reserve0Old, uint112 reserve1Old) private returns (bool feeActive) {
        address recipient = IFactoryFee(factory).feeRecipient();
        feeActive = recipient != address(0);

        uint256 lastK = kLast;
        if (feeActive) {
            if (lastK != 0) {
                uint256 rootK = MathUtils.sqrt(uint256(reserve0Old) * reserve1Old);
                uint256 rootKLast = MathUtils.sqrt(lastK);
                if (rootK > rootKLast) {
                    uint256 numerator = totalSupply * (rootK - rootKLast);
                    uint256 denominator = (rootK * 3) + rootKLast;
                    uint256 liquidity = numerator / denominator;
                    if (liquidity > 0) {
                        _mint(recipient, liquidity);
                    }
                }
            }
        } else if (lastK != 0) {
            kLast = 0;
        }
    }

    function mint(address to) external lock returns (uint256 liquidity) {
        (uint112 reserve0Old, uint112 reserve1Old, ) = getReserves();
        uint256 balance0 = IERC20Minimal(token0).balanceOf(address(this));
        uint256 balance1 = IERC20Minimal(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - reserve0Old;
        uint256 amount1 = balance1 - reserve1Old;

        bool feeActive = _mintFee(reserve0Old, reserve1Old);
        uint256 totalSupplyCached = totalSupply;

        if (totalSupplyCached == 0) {
            liquidity = MathUtils.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY);
        } else {
            liquidity = MathUtils.min(
                (amount0 * totalSupplyCached) / reserve0Old,
                (amount1 * totalSupplyCached) / reserve1Old
            );
        }

        require(liquidity > 0, "Pair: insufficient liquidity minted");
        _mint(to, liquidity);

        _update(balance0, balance1, reserve0Old, reserve1Old);
        if (feeActive) {
            kLast = uint256(_reserve0) * _reserve1;
        }

        emit Mint(msg.sender, amount0, amount1);
    }

    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        (uint112 reserve0Old, uint112 reserve1Old, ) = getReserves();
        address _token0 = token0;
        address _token1 = token1;

        uint256 balance0 = IERC20Minimal(_token0).balanceOf(address(this));
        uint256 balance1 = IERC20Minimal(_token1).balanceOf(address(this));
        uint256 liquidity = balanceOf[address(this)];

        bool feeActive = _mintFee(reserve0Old, reserve1Old);
        uint256 totalSupplyCached = totalSupply;

        amount0 = (liquidity * balance0) / totalSupplyCached;
        amount1 = (liquidity * balance1) / totalSupplyCached;
        require(amount0 > 0 && amount1 > 0, "Pair: insufficient liquidity burned");

        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);

        balance0 = IERC20Minimal(_token0).balanceOf(address(this));
        balance1 = IERC20Minimal(_token1).balanceOf(address(this));

        _update(balance0, balance1, reserve0Old, reserve1Old);
        if (feeActive) {
            kLast = uint256(_reserve0) * _reserve1;
        }

        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external lock {
        require(amount0Out > 0 || amount1Out > 0, "Pair: insufficient output amount");
        (uint112 reserve0Old, uint112 reserve1Old, ) = getReserves();
        require(amount0Out < reserve0Old && amount1Out < reserve1Old, "Pair: insufficient liquidity");

        uint256 balance0;
        uint256 balance1;
        {
            address _token0 = token0;
            address _token1 = token1;
            require(to != _token0 && to != _token1, "Pair: invalid recipient");

            if (amount0Out > 0) {
                _safeTransfer(_token0, to, amount0Out);
            }
            if (amount1Out > 0) {
                _safeTransfer(_token1, to, amount1Out);
            }
            if (data.length > 0) {
                IPairCallee(to).onSwap(msg.sender, amount0Out, amount1Out, data);
            }

            balance0 = IERC20Minimal(_token0).balanceOf(address(this));
            balance1 = IERC20Minimal(_token1).balanceOf(address(this));
        }

        uint256 amount0In = balance0 > reserve0Old - amount0Out ? balance0 - (reserve0Old - amount0Out) : 0;
        uint256 amount1In = balance1 > reserve1Old - amount1Out ? balance1 - (reserve1Old - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "Pair: insufficient input amount");

        {
            uint256 balance0Adjusted = (balance0 * 10000) - (amount0In * SWAP_FEE_BPS);
            uint256 balance1Adjusted = (balance1 * 10000) - (amount1In * SWAP_FEE_BPS);
            require(
                balance0Adjusted * balance1Adjusted >= uint256(reserve0Old) * reserve1Old * (10000 ** 2),
                "Pair: K"
            );
        }

        _update(balance0, balance1, reserve0Old, reserve1Old);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function skim(address to) external lock {
        address _token0 = token0;
        address _token1 = token1;
        _safeTransfer(_token0, to, IERC20Minimal(_token0).balanceOf(address(this)) - _reserve0);
        _safeTransfer(_token1, to, IERC20Minimal(_token1).balanceOf(address(this)) - _reserve1);
    }

    function sync() external lock {
        _update(
            IERC20Minimal(token0).balanceOf(address(this)),
            IERC20Minimal(token1).balanceOf(address(this)),
            _reserve0,
            _reserve1
        );
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Pair: transfer failed");
    }

    function _mint(address to, uint256 value) private {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            allowance[from][msg.sender] = currentAllowance - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
