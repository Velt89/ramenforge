// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title MockAgentID — LOCAL TESTS ONLY
/// @notice Minimal stand-in for the SPACE ID Agent ID registry implementing
/// just balanceOf(address), plus a setHolder test helper. Never deploy this
/// to a live network as part of RamenForge.
contract MockAgentID {
    mapping(address => bool) private _holders;

    function setHolder(address account, bool holds) external {
        _holders[account] = holds;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _holders[owner] ? 1 : 0;
    }
}
