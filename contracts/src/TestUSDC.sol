// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TestUSDC
/// @notice Six-decimal ERC-20 with an open faucet, for local chains and the
///         Base Sepolia demo.
/// @dev `mint` is deliberately unguarded, so this must never reach a network
///      where a token balance is worth anything — mainnet above all.
///
///      It is deployed to Base Sepolia all the same. Circle's testnet USDC is
///      faucet-rationed at roughly ten a day and the demo moves several
///      thousand, so the choice was between a mintable token and a demo whose
///      amounts read in fractions of a dollar. Anyone can mint this one; on a
///      testnet that costs nothing, because nothing here is worth anything.
///      RoleboundPay takes the token as an argument, so only the address the
///      app points at changes.
contract TestUSDC {
    string public constant name = "Test USD Coin";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        // Treat max allowance as infinite, the way USDC and OpenZeppelin do —
        // the role wallet approves RoleboundPay once and never again.
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
