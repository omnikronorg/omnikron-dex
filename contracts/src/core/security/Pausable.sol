// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

abstract contract Pausable {
    bool private _paused;
    address public guardian;

    event Paused(address account);
    event Unpaused(address account);

    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == guardian, "Pausable: not guardian");
        _;
    }

    constructor(address guardian_) {
        guardian = guardian_;
    }

    function pause() external onlyGuardian {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyGuardian {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    function paused() external view returns (bool) {
        return _paused;
    }
}
