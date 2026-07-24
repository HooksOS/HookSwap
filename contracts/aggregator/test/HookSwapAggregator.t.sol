// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { HookSwapAggregator } from "../src/HookSwapAggregator.sol";
import { IPermit2 } from "../src/IPermit2.sol";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Minimal constant-rate DEX router double. Pulls `amountIn` of `tokenIn`
///      from the caller (the aggregator, which approved it) and pays `amountOut`
///      of `tokenOut` to `to`. Must be pre-funded with `tokenOut`.
contract MockRouter {
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut, address to) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(to, amountOut);
    }
}

/// @dev Router that re-enters the aggregator's swap during execution.
contract ReentrantRouter {
    HookSwapAggregator public immutable agg;

    constructor(HookSwapAggregator _agg) {
        agg = _agg;
    }

    function swap(address, uint256, address, uint256, address) external {
        HookSwapAggregator.SwapDescription memory desc;
        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](0);
        // Should revert with ReentrancyGuardReentrantCall -> bubbles as CallFailed.
        agg.swap(desc, calls);
    }
}

/// @dev Router that tries to pull MORE than it was approved for.
contract GreedyRouter {
    function swap(address tokenIn, uint256 approvedAmount, address, uint256, address) external {
        // Attempt to pull double — must fail (approval is exact).
        IERC20(tokenIn).transferFrom(msg.sender, address(this), approvedAmount * 2);
    }
}

// ---------------------------------------------------------------------------
// Unit tests (no fork)
// ---------------------------------------------------------------------------

contract HookSwapAggregatorUnitTest is Test {
    HookSwapAggregator internal agg;
    MockRouter internal router1;
    MockRouter internal router2;
    MockERC20 internal src;
    MockERC20 internal dst;

    address internal owner = address(0xA11CE);
    address internal treasury = 0x011d438E3eb3fce848950859591ec037C6529E13;
    address internal user = address(0xBEEF);
    address internal receiver = address(0xCAFE);

    function setUp() public {
        vm.prank(owner);
        agg = new HookSwapAggregator(owner, address(0)); // default treasury

        router1 = new MockRouter();
        router2 = new MockRouter();
        src = new MockERC20("Source", "SRC", 18);
        dst = new MockERC20("Dest", "DST", 18);

        vm.startPrank(owner);
        agg.setRouterAllowed(address(router1), true);
        agg.setRouterAllowed(address(router2), true);
        vm.stopPrank();

        // Fund routers with output token so they can pay out.
        dst.mint(address(router1), 1_000_000 ether);
        dst.mint(address(router2), 1_000_000 ether);

        // Fund user + approve aggregator.
        src.mint(user, 1_000_000 ether);
        vm.prank(user);
        src.approve(address(agg), type(uint256).max);
    }

    function _desc(uint256 amountIn, uint256 minOut) internal view returns (HookSwapAggregator.SwapDescription memory) {
        return HookSwapAggregator.SwapDescription({
            srcToken: address(src),
            dstToken: address(dst),
            amountIn: amountIn,
            minAmountOut: minOut,
            receiver: receiver
        });
    }

    function _leg(address target, address tokenIn, uint256 amtIn, address tokenOut, uint256 amtOut)
        internal
        view
        returns (HookSwapAggregator.Call memory)
    {
        return HookSwapAggregator.Call({
            target: target,
            inputToken: tokenIn,
            inputAmount: amtIn,
            data: abi.encodeWithSelector(MockRouter.swap.selector, tokenIn, amtIn, tokenOut, amtOut, address(agg))
        });
    }

    // --- Core: split across two routers, 0.2% fee skim -----------------------

    function test_SplitSwap_FeeSkimmedToTreasury() public {
        uint256 amountIn = 1000 ether;
        // Leg1: 600 SRC -> 600 DST via router1. Leg2: 400 SRC -> 400 DST via router2.
        // Total out before fee = 1000 DST.
        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](2);
        calls[0] = _leg(address(router1), address(src), 600 ether, address(dst), 600 ether);
        calls[1] = _leg(address(router2), address(src), 400 ether, address(dst), 400 ether);

        uint256 expectedGross = 1000 ether;
        uint256 expectedFee = (expectedGross * 20) / 10_000; // 0.2%
        uint256 expectedNet = expectedGross - expectedFee;

        vm.prank(user);
        uint256 out = agg.swap(_desc(amountIn, expectedNet), calls);

        assertEq(out, expectedNet, "returned amountOut");
        assertEq(dst.balanceOf(receiver), expectedNet, "receiver got net");
        assertEq(dst.balanceOf(treasury), expectedFee, "treasury got 0.2%");
        assertEq(expectedFee, 2 ether, "fee is exactly 0.2% of 1000");

        // (f) No funds trapped in the contract.
        assertEq(src.balanceOf(address(agg)), 0, "no src left");
        assertEq(dst.balanceOf(address(agg)), 0, "no dst left");
    }

    // --- minAmountOut enforcement -------------------------------------------

    function test_Revert_WhenMinOutTooHigh() public {
        uint256 amountIn = 1000 ether;
        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = _leg(address(router1), address(src), 1000 ether, address(dst), 1000 ether);

        uint256 gross = 1000 ether;
        uint256 net = gross - (gross * 20) / 10_000; // 998
        // Demand more than achievable.
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HookSwapAggregator.InsufficientOutput.selector, net, net + 1));
        agg.swap(_desc(amountIn, net + 1), calls);
    }

    // --- allowlist enforcement ----------------------------------------------

    function test_Revert_WhenRouterNotAllowlisted() public {
        MockRouter rogue = new MockRouter();
        dst.mint(address(rogue), 1000 ether);
        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = _leg(address(rogue), address(src), 1000 ether, address(dst), 1000 ether);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HookSwapAggregator.RouterNotAllowed.selector, address(rogue)));
        agg.swap(_desc(1000 ether, 0), calls);
    }

    // --- forbidden target (src/dst/permit2/self) ----------------------------

    function test_Revert_WhenTargetIsSrcToken() public {
        // Even if an attacker-owner allowlists the src token, targeting it is blocked.
        vm.prank(owner);
        agg.setRouterAllowed(address(src), true);

        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = HookSwapAggregator.Call({
            target: address(src),
            inputToken: address(src),
            inputAmount: 1000 ether,
            data: abi.encodeWithSelector(IERC20.transferFrom.selector, user, address(agg), 1000 ether)
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HookSwapAggregator.ForbiddenTarget.selector, address(src)));
        agg.swap(_desc(1000 ether, 0), calls);
    }

    // --- reentrancy negative test -------------------------------------------

    function test_Revert_OnReentrantRouter() public {
        ReentrantRouter rr = new ReentrantRouter(agg);
        vm.prank(owner);
        agg.setRouterAllowed(address(rr), true);

        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = HookSwapAggregator.Call({
            target: address(rr),
            inputToken: address(src),
            inputAmount: 1 ether,
            data: abi.encodeWithSelector(MockRouter.swap.selector, address(src), 1 ether, address(dst), 0, address(agg))
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HookSwapAggregator.CallFailed.selector, 0));
        agg.swap(_desc(1 ether, 0), calls);
    }

    // --- malicious router cannot pull more than its exact approval -----------

    function test_Revert_GreedyRouterCannotOverPull() public {
        GreedyRouter greedy = new GreedyRouter();
        vm.prank(owner);
        agg.setRouterAllowed(address(greedy), true);

        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = HookSwapAggregator.Call({
            target: address(greedy),
            inputToken: address(src),
            inputAmount: 100 ether,
            data: abi.encodeWithSelector(GreedyRouter.swap.selector, address(src), 100 ether, address(dst), 0, address(agg))
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(HookSwapAggregator.CallFailed.selector, 0));
        agg.swap(_desc(100 ether, 0), calls);
    }

    // --- unspent src input is refunded to receiver --------------------------

    function test_RefundsUnspentSrcDust() public {
        uint256 amountIn = 1000 ether;
        // Plan only consumes 900 SRC -> 100 SRC dust must be refunded.
        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = _leg(address(router1), address(src), 900 ether, address(dst), 900 ether);

        vm.prank(user);
        agg.swap(_desc(amountIn, 0), calls);

        assertEq(src.balanceOf(receiver), 100 ether, "src dust refunded");
        assertEq(src.balanceOf(address(agg)), 0, "no src trapped");
        assertEq(dst.balanceOf(address(agg)), 0, "no dst trapped");
    }

    // --- zero output reverts -------------------------------------------------

    function test_Revert_NoOutput() public {
        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = _leg(address(router1), address(src), 1000 ether, address(dst), 0);
        vm.prank(user);
        vm.expectRevert(HookSwapAggregator.NoOutput.selector);
        agg.swap(_desc(1000 ether, 0), calls);
    }

    // --- owner admin & guards ------------------------------------------------

    function test_Revert_SetFeeAboveCap() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(HookSwapAggregator.FeeTooHigh.selector, 101));
        agg.setFeeBps(101);
    }

    function test_SetFeeWithinCap() public {
        vm.prank(owner);
        agg.setFeeBps(50);
        assertEq(agg.feeBps(), 50);
    }

    function test_Revert_NonOwnerAllowlist() public {
        vm.prank(user);
        vm.expectRevert();
        agg.setRouterAllowed(address(0x1234), true);
    }

    function test_DefaultTreasuryAndFee() public view {
        assertEq(agg.treasury(), treasury, "default treasury");
        assertEq(agg.feeBps(), 20, "default 0.2%");
    }

    function test_SetTreasury() public {
        address newT = address(0xD00D);
        vm.prank(owner);
        agg.setTreasury(newT);
        assertEq(agg.treasury(), newT);
    }

    function test_FeeAppliedAtCustomRate() public {
        vm.prank(owner);
        agg.setFeeBps(100); // 1%
        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = _leg(address(router1), address(src), 1000 ether, address(dst), 1000 ether);
        vm.prank(user);
        agg.swap(_desc(1000 ether, 0), calls);
        assertEq(dst.balanceOf(treasury), 10 ether, "1% fee");
        assertEq(dst.balanceOf(receiver), 990 ether, "receiver net");
    }
}

// ---------------------------------------------------------------------------
// Sepolia FORK test — splits a real swap across two Uniswap Sepolia v2 pools
// ---------------------------------------------------------------------------

interface IUniV2Router {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
}

contract HookSwapAggregatorForkTest is Test {
    // Canonical Uniswap v2 on Sepolia — VERIFIED on-chain 2026-07-24:
    //   router.factory() == 0xF62c03E08ada871A0bEb309762E260a7a6a880E6
    //   router.WETH()    == 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
    address internal constant UNIV2_ROUTER = 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    string internal constant SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

    HookSwapAggregator internal agg;
    IUniV2Router internal router;
    MockERC20 internal TA; // src
    MockERC20 internal TB; // dst
    MockERC20 internal TC; // intermediate

    address internal owner = address(0xA11CE);
    address internal treasury = 0x011d438E3eb3fce848950859591ec037C6529E13;
    uint256 internal userPk = 0xA11CE5EED; // for Permit2 signing
    address internal user;
    address internal receiver = address(0xCAFE);

    bool internal forked;

    function setUp() public {
        // Network-gated: only run if the Sepolia RPC is reachable.
        try vm.createFork(SEPOLIA_RPC) returns (uint256 forkId) {
            vm.selectFork(forkId);
            forked = true;
        } catch {
            forked = false;
            return;
        }
        require(block.chainid == 11155111, "not Sepolia");
        user = vm.addr(userPk);

        router = IUniV2Router(UNIV2_ROUTER);
        agg = new HookSwapAggregator(owner, treasury);
        vm.prank(owner);
        agg.setRouterAllowed(UNIV2_ROUTER, true);

        TA = new MockERC20("TokenA", "TA", 18);
        TB = new MockERC20("TokenB", "TB", 18);
        TC = new MockERC20("TokenC", "TC", 18);

        // Seed three real Uniswap v2 pools via the canonical router/factory:
        //   TA/TB (direct route), TA/TC + TC/TB (2-hop route).
        _addLiquidity(TA, TB, 100_000 ether, 100_000 ether);
        _addLiquidity(TA, TC, 100_000 ether, 100_000 ether);
        _addLiquidity(TC, TB, 100_000 ether, 100_000 ether);

        // Fund the user with src token.
        TA.mint(user, 10_000 ether);
    }

    function _addLiquidity(MockERC20 a, MockERC20 b, uint256 amtA, uint256 amtB) internal {
        a.mint(address(this), amtA);
        b.mint(address(this), amtB);
        a.approve(UNIV2_ROUTER, amtA);
        b.approve(UNIV2_ROUTER, amtB);
        router.addLiquidity(address(a), address(b), amtA, amtB, 0, 0, address(this), block.timestamp + 1);
    }

    function test_Fork_SplitAcrossTwoPools_FeeAndNoTrappedFunds() public {
        if (!forked) {
            emit log("SKIP: Sepolia RPC unreachable (network-gated fork test)");
            return;
        }

        uint256 amountIn = 1000 ether;
        uint256 half = amountIn / 2;

        // Compute expected outputs from the real pools.
        address[] memory pathDirect = new address[](2);
        pathDirect[0] = address(TA);
        pathDirect[1] = address(TB);
        address[] memory pathHop = new address[](3);
        pathHop[0] = address(TA);
        pathHop[1] = address(TC);
        pathHop[2] = address(TB);

        uint256 outDirect = router.getAmountsOut(half, pathDirect)[1];
        uint256 outHop = router.getAmountsOut(half, pathHop)[2];
        uint256 grossOut = outDirect + outHop;
        uint256 expectedFee = (grossOut * 20) / 10_000;
        uint256 expectedNet = grossOut - expectedFee;

        // Build the two-leg plan; both legs output TB to the aggregator.
        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](2);
        calls[0] = HookSwapAggregator.Call({
            target: UNIV2_ROUTER,
            inputToken: address(TA),
            inputAmount: half,
            data: abi.encodeWithSelector(
                IUniV2Router.swapExactTokensForTokens.selector, half, 0, pathDirect, address(agg), block.timestamp + 1
            )
        });
        calls[1] = HookSwapAggregator.Call({
            target: UNIV2_ROUTER,
            inputToken: address(TA),
            inputAmount: half,
            data: abi.encodeWithSelector(
                IUniV2Router.swapExactTokensForTokens.selector, half, 0, pathHop, address(agg), block.timestamp + 1
            )
        });

        HookSwapAggregator.SwapDescription memory desc = HookSwapAggregator.SwapDescription({
            srcToken: address(TA),
            dstToken: address(TB),
            amountIn: amountIn,
            minAmountOut: expectedNet,
            receiver: receiver
        });

        vm.prank(user);
        TA.approve(address(agg), amountIn);
        vm.prank(user);
        uint256 out = agg.swap(desc, calls);

        assertEq(out, expectedNet, "net out matches real-pool quote");
        assertEq(TB.balanceOf(receiver), expectedNet, "receiver got net TB");
        assertEq(TB.balanceOf(treasury), expectedFee, "treasury got 0.2% of real output");
        assertGt(expectedFee, 0, "fee is non-zero");

        // No funds trapped anywhere in the aggregator.
        assertEq(TA.balanceOf(address(agg)), 0, "no TA trapped");
        assertEq(TB.balanceOf(address(agg)), 0, "no TB trapped");
        assertEq(TC.balanceOf(address(agg)), 0, "no TC trapped");

        emit log_named_uint("grossOut (TB)", grossOut);
        emit log_named_uint("fee 0.2% (TB)", expectedFee);
        emit log_named_uint("net to receiver", expectedNet);
    }

    function test_Fork_Revert_MinOutTooHigh() public {
        if (!forked) {
            emit log("SKIP: Sepolia RPC unreachable (network-gated fork test)");
            return;
        }
        uint256 amountIn = 1000 ether;
        address[] memory pathDirect = new address[](2);
        pathDirect[0] = address(TA);
        pathDirect[1] = address(TB);
        uint256 grossOut = router.getAmountsOut(amountIn, pathDirect)[1];
        uint256 net = grossOut - (grossOut * 20) / 10_000;

        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = HookSwapAggregator.Call({
            target: UNIV2_ROUTER,
            inputToken: address(TA),
            inputAmount: amountIn,
            data: abi.encodeWithSelector(
                IUniV2Router.swapExactTokensForTokens.selector, amountIn, 0, pathDirect, address(agg), block.timestamp + 1
            )
        });
        HookSwapAggregator.SwapDescription memory desc = HookSwapAggregator.SwapDescription({
            srcToken: address(TA),
            dstToken: address(TB),
            amountIn: amountIn,
            minAmountOut: net + 1 ether, // impossible
            receiver: receiver
        });

        vm.prank(user);
        TA.approve(address(agg), amountIn);
        vm.prank(user);
        vm.expectRevert(); // InsufficientOutput
        agg.swap(desc, calls);
    }

    function test_Fork_Permit2Path() public {
        if (!forked) {
            emit log("SKIP: Sepolia RPC unreachable (network-gated fork test)");
            return;
        }
        uint256 amountIn = 500 ether;
        // User approves the REAL Permit2 for the src token.
        vm.prank(user);
        TA.approve(PERMIT2, type(uint256).max);

        address[] memory pathDirect = new address[](2);
        pathDirect[0] = address(TA);
        pathDirect[1] = address(TB);
        uint256 grossOut = router.getAmountsOut(amountIn, pathDirect)[1];
        uint256 net = grossOut - (grossOut * 20) / 10_000;

        HookSwapAggregator.Call[] memory calls = new HookSwapAggregator.Call[](1);
        calls[0] = HookSwapAggregator.Call({
            target: UNIV2_ROUTER,
            inputToken: address(TA),
            inputAmount: amountIn,
            data: abi.encodeWithSelector(
                IUniV2Router.swapExactTokensForTokens.selector, amountIn, 0, pathDirect, address(agg), block.timestamp + 1
            )
        });
        HookSwapAggregator.SwapDescription memory desc = HookSwapAggregator.SwapDescription({
            srcToken: address(TA),
            dstToken: address(TB),
            amountIn: amountIn,
            minAmountOut: net,
            receiver: receiver
        });

        (IPermit2.PermitTransferFrom memory permit, bytes memory sig) =
            _signPermit2(address(TA), amountIn, 0, block.timestamp + 1, address(agg));

        vm.prank(user);
        uint256 out = agg.swapWithPermit2(desc, calls, permit, sig);
        assertEq(out, net, "permit2 path net out");
        assertEq(TB.balanceOf(receiver), net, "receiver got net via permit2");
        assertEq(TB.balanceOf(treasury), grossOut - net, "treasury fee via permit2");
    }

    // --- Permit2 EIP-712 SignatureTransfer helper ---------------------------

    function _signPermit2(address token, uint256 amount, uint256 nonce, uint256 deadline, address spender)
        internal
        view
        returns (IPermit2.PermitTransferFrom memory permit, bytes memory sig)
    {
        bytes32 TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");
        bytes32 PERMIT_TRANSFER_FROM_TYPEHASH = keccak256(
            "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
        );
        bytes32 domainSeparator = IPermit2DomainSeparator(PERMIT2).DOMAIN_SEPARATOR();

        bytes32 tokenPermissionsHash = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, token, amount));
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TRANSFER_FROM_TYPEHASH, tokenPermissionsHash, spender, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        sig = abi.encodePacked(r, s, v);
        permit = IPermit2.PermitTransferFrom({
            permitted: IPermit2.TokenPermissions({ token: token, amount: amount }),
            nonce: nonce,
            deadline: deadline
        });
    }
}

interface IPermit2DomainSeparator {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
