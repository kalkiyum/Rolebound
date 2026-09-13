// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title RoleboundPay
/// @notice The single route by which a role wallet may move funds.
/// @dev Each role wallet's Privy policy allowlists ONLY this contract, so a
///      role is structurally unable to spend without committing a justification.
///      The accountability is not a habit the UI encourages — it is the only
///      thing the wallet is able to do.
contract RoleboundPay {
    /// @param roleId      Off-chain role identifier, indexed for per-role audit.
    /// @param roleWallet  The spending wallet (msg.sender) — the role itself.
    /// @param to          Recipient.
    /// @param token       ERC-20 moved.
    /// @param amount      Base units.
    /// @param reasonHash  keccak256 of the justification. Plaintext stays
    ///                    off-chain so a public org gets tamper-evidence
    ///                    without publishing sensitive reasons.
    /// @param actor       The person or agent who authorized it. Distinct from
    ///                    roleWallet: the role holds the funds, the actor
    ///                    answers for the decision.
    event Payment(
        bytes32 indexed roleId,
        address indexed roleWallet,
        address indexed to,
        address token,
        uint256 amount,
        bytes32 reasonHash,
        address actor
    );

    error TransferFailed();
    error EmptyReason();
    error ZeroRecipient();
    error ZeroAmount();

    /// @notice Move `amount` of `token` from the caller to `to`, committing
    ///         `reasonHash` in the same transaction.
    /// @dev Caller must have approved this contract. Reverting on an empty
    ///      reason hash makes "pay without a reason" impossible on-chain as
    ///      well as in the app — the invariant holds even if the app is bypassed.
    function pay(
        bytes32 roleId,
        IERC20 token,
        address to,
        uint256 amount,
        bytes32 reasonHash,
        address actor
    ) external {
        if (reasonHash == bytes32(0)) revert EmptyReason();
        if (to == address(0)) revert ZeroRecipient();
        if (amount == 0) revert ZeroAmount();

        // Tokens move caller -> recipient directly; this contract never custodies.
        if (!token.transferFrom(msg.sender, to, amount)) revert TransferFailed();

        emit Payment(roleId, msg.sender, to, address(token), amount, reasonHash, actor);
    }
}
