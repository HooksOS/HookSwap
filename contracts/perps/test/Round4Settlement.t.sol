// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/perpetual/Settlement.sol";
import "./invariant/Mocks.sol";

/**
 * @title Round4SettlementTest
 * @notice MED-3 regression (round-4 adversarial audit): the signed LIMIT-price enforcement (H-2) is now
 *         ported into the standalone Settlement.sol. A matcher may not fill a LIMIT order outside its
 *         signed price; a compliant fill still settles. Standalone Settlement (no OracleGuard wired → the
 *         deviation guard is a no-op, so this isolates the LIMIT check). EIP-712 domain = ("HookSwapPerps","1").
 *
 *         Lives in its own file because PerpMarket.sol and Settlement.sol both declare a top-level
 *         IOracleGuardCheck / IWETH interface — importing both into one unit clashes.
 */
contract Round4SettlementTest is Test {
    uint256 constant PK_A = uint256(keccak256("round4.settle.A"));
    uint256 constant PK_B = uint256(keccak256("round4.settle.B"));

    Settlement settlement;
    MockERC20 col;
    address A;
    address B;

    function setUp() public {
        A = vm.addr(PK_A);
        B = vm.addr(PK_B);
        col = new MockERC20("Collateral", "COL", 18);
        settlement = new Settlement(); // owner = this, matcher-trusted (no oracle guard wired)
        settlement.addSupportedToken(address(col), 18);
        settlement.setAuthorizedMatcher(address(this), true);
        _fund(A, 1e18);
        _fund(B, 1e18);
    }

    function _fund(address who, uint256 amt) internal {
        col.mint(who, amt);
        vm.prank(who);
        col.approve(address(settlement), amt);
        vm.prank(who);
        settlement.deposit(address(col), amt);
    }

    function _order(address t, bool isLong, uint256 price, Settlement.OrderType ot)
        internal view returns (Settlement.Order memory)
    {
        return Settlement.Order({
            trader: t, token: address(col), isLong: isLong, size: 1e16, leverage: 10 * 1e4, price: price,
            deadline: block.timestamp + 1_000_000, nonce: 0, orderType: ot
        });
    }

    function _pair(uint256 matchPrice, uint256 longLimit, uint256 shortLimit, Settlement.OrderType longOt, Settlement.OrderType shortOt)
        internal view returns (Settlement.MatchedPair[] memory pairs)
    {
        Settlement.Order memory lo = _order(A, true, longLimit, longOt);
        Settlement.Order memory so = _order(B, false, shortLimit, shortOt);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(PK_A, settlement.getOrderHash(lo));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(PK_B, settlement.getOrderHash(so));
        pairs = new Settlement.MatchedPair[](1);
        pairs[0] = Settlement.MatchedPair({
            longOrder: lo, longSignature: abi.encodePacked(r1, s1, v1),
            shortOrder: so, shortSignature: abi.encodePacked(r2, s2, v2),
            matchPrice: matchPrice, matchSize: 1e16
        });
    }

    function test_MED3_LimitPriceEnforcedInSettlement() public {
        // A LIMIT long signed @ $2000 filled 0.05% ABOVE ($2001) must revert LimitPriceViolated.
        Settlement.MatchedPair[] memory bad =
            _pair(2001e18, 2000e18 /*long limit*/, 0, Settlement.OrderType.LIMIT, Settlement.OrderType.MARKET);
        vm.expectRevert(Settlement.LimitPriceViolated.selector);
        settlement.settleBatch(bad);
        emit log_string("MED-3 OK: LIMIT long filled above its signed price reverts LimitPriceViolated");

        // A LIMIT short signed @ $2000 filled BELOW ($1999) must also revert.
        Settlement.MatchedPair[] memory badShort =
            _pair(1999e18, 0, 2000e18 /*short limit*/, Settlement.OrderType.MARKET, Settlement.OrderType.LIMIT);
        vm.expectRevert(Settlement.LimitPriceViolated.selector);
        settlement.settleBatch(badShort);
        emit log_string("MED-3 OK: LIMIT short filled below its signed price reverts LimitPriceViolated");

        // A compliant fill (long @ its limit) settles.
        Settlement.MatchedPair[] memory ok =
            _pair(2000e18, 2000e18, 0, Settlement.OrderType.LIMIT, Settlement.OrderType.MARKET);
        settlement.settleBatch(ok);
        Settlement.PairedPosition memory pos = settlement.getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(Settlement.PositionStatus.ACTIVE), "compliant LIMIT fill failed");
        emit log_string("MED-3 OK: LIMIT order filled at its signed price settles");
    }
}
