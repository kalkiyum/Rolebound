// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {RoleboundPay, IERC20} from "../src/RoleboundPay.sol";

/// @dev Minimal ERC-20. `transferFrom` reverts on insufficient allowance,
///      matching OpenZeppelin behaviour.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Some real tokens (USDT and friends) return false instead of reverting.
///      RoleboundPay must catch that rather than emit a Payment for funds that
///      never moved — otherwise the audit trail records a payment that did not
///      happen, which is worse than no trail at all.
contract SilentFailToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

contract RoleboundPayTest is Test {
    RoleboundPay internal pay;
    MockERC20 internal usdc;

    address internal roleWallet = makeAddr("roleWallet");
    address internal actor = makeAddr("actor");
    address internal vendor = makeAddr("vendor");

    bytes32 internal constant ROLE_ID = keccak256("marketing");
    bytes32 internal constant REASON = keccak256("Landing page design, invoice #204");
    uint256 internal constant AMOUNT = 200e6; // 200 USDC

    event Payment(
        bytes32 indexed roleId,
        address indexed roleWallet,
        address indexed to,
        address token,
        uint256 amount,
        bytes32 reasonHash,
        address actor
    );

    function setUp() public {
        pay = new RoleboundPay();
        usdc = new MockERC20();
        usdc.mint(roleWallet, 10_000e6);
        vm.prank(roleWallet);
        usdc.approve(address(pay), type(uint256).max);
    }

    function _pay(uint256 amount, bytes32 reason, address to) internal {
        vm.prank(roleWallet);
        pay.pay(ROLE_ID, IERC20(address(usdc)), to, amount, reason, actor);
    }

    function test_movesFundsFromRoleToRecipient() public {
        _pay(AMOUNT, REASON, vendor);
        assertEq(usdc.balanceOf(vendor), AMOUNT, "vendor credited");
        assertEq(usdc.balanceOf(roleWallet), 10_000e6 - AMOUNT, "role debited");
    }

    /// The contract is a conduit, never a custodian. If it ever holds a
    /// balance, funds can be stranded in it.
    function test_contractNeverHoldsFunds() public {
        _pay(AMOUNT, REASON, vendor);
        assertEq(usdc.balanceOf(address(pay)), 0, "contract holds nothing");
    }

    function test_emitsPaymentWithActorAndReason() public {
        vm.expectEmit(true, true, true, true, address(pay));
        emit Payment(ROLE_ID, roleWallet, vendor, address(usdc), AMOUNT, REASON, actor);
        _pay(AMOUNT, REASON, vendor);
    }

    /// The actor is the person or agent who answers for the decision; the role
    /// wallet is where the money lived. Conflating them loses the accountability.
    function test_actorIsRecordedSeparatelyFromRoleWallet() public {
        vm.recordLogs();
        _pay(AMOUNT, REASON, vendor);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (, , bytes32 loggedReason, address loggedActor) =
            abi.decode(logs[logs.length - 1].data, (address, uint256, bytes32, address));
        assertEq(loggedReason, REASON, "reason committed");
        assertEq(loggedActor, actor, "actor preserved");
        assertTrue(loggedActor != roleWallet, "actor is not the role wallet");
    }

    /// The core invariant: no payment without a justification, enforced on-chain
    /// so it holds even if the application is bypassed entirely.
    function test_revertsOnEmptyReason() public {
        vm.expectRevert(RoleboundPay.EmptyReason.selector);
        _pay(AMOUNT, bytes32(0), vendor);
    }

    function test_revertsOnZeroRecipient() public {
        vm.expectRevert(RoleboundPay.ZeroRecipient.selector);
        _pay(AMOUNT, REASON, address(0));
    }

    function test_revertsOnZeroAmount() public {
        vm.expectRevert(RoleboundPay.ZeroAmount.selector);
        _pay(0, REASON, vendor);
    }

    function test_revertsWhenTokenReturnsFalse() public {
        SilentFailToken bad = new SilentFailToken();
        vm.prank(roleWallet);
        vm.expectRevert(RoleboundPay.TransferFailed.selector);
        pay.pay(ROLE_ID, IERC20(address(bad)), vendor, AMOUNT, REASON, actor);
    }

    function test_revertsWithoutApproval() public {
        address unapproved = makeAddr("unapproved");
        usdc.mint(unapproved, AMOUNT);
        vm.prank(unapproved);
        vm.expectRevert(bytes("allowance"));
        pay.pay(ROLE_ID, IERC20(address(usdc)), vendor, AMOUNT, REASON, actor);
    }

    function testFuzz_anyValidPaymentMovesExactly(uint96 amount, bytes32 reason) public {
        vm.assume(amount > 0 && amount <= 10_000e6);
        vm.assume(reason != bytes32(0));
        uint256 before = usdc.balanceOf(vendor);
        _pay(amount, reason, vendor);
        assertEq(usdc.balanceOf(vendor) - before, amount, "exact amount, no rounding");
    }
}
