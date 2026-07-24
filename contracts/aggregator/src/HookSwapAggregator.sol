// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IPermit2 } from "./IPermit2.sol";

/// @title HookSwapAggregator
/// @author HookSwap
/// @notice Cross-DEX aggregation EXECUTOR. Routes a single user swap across
///         multiple DEX venues (HookSwap own v2/v3, Uniswap v2/v3, PancakeSwap
///         v2/v3, ...) by executing an off-chain-computed plan of router calls,
///         then skims a protocol fee (default 0.2% / 20 bps) from the OUTPUT
///         token to the treasury and forwards the remainder to the receiver.
///
///         It exists because HookSwap's deployed Universal Router is factory-
///         hardcoded and cannot execute swaps through foreign pools. This
///         executor is DEX-agnostic: adding a venue = owner-allowlisting its
///         router address (no redeploy), matching HookSwap's config-driven
///         extensibility rule.
///
/// @dev    THREAT MODEL / SECURITY INVARIANTS (see README.md for full write-up):
///         1. Arbitrary external calls are the core risk. Only OWNER-allowlisted
///            router targets may be called (`allowedRouter`). A leg may NEVER
///            target the srcToken, dstToken, Permit2, or this contract itself
///            (prevents `transferFrom(victim, ...)` style token draining).
///         2. Per-leg approvals are EXACT: the contract approves `target` for
///            precisely `inputAmount` of `inputToken`, then zeroes the approval
///            immediately after the call. No standing allowances remain.
///         3. `nonReentrant` on every value-moving entrypoint. Router callbacks
///            cannot re-enter the swap path.
///         4. Balance-delta accounting: output is measured as the dstToken
///            balance INCREASE across execution, so a leg cannot cause funds to
///            be over-credited. Unspent src input above the pre-call baseline is
///            refunded to the receiver; the contract does not sweep or trust any
///            pre-existing token balance.
///         5. The contract is designed to hold NO funds between transactions.
///
///         This contract handles ERC20 -> ERC20 swaps. Native ETH must be
///         wrapped to WETH off-chain / by the plan before entering. Entrypoints
///         are non-payable and every leg is called with 0 native value.
contract HookSwapAggregator is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Canonical Permit2 (same address on every HookSwap chain).
    IPermit2 public constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    /// @notice Basis-point denominator.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard cap on the protocol fee (1%). The fee can NEVER exceed this,
    ///         even by owner action.
    uint256 public constant MAX_FEE_BPS = 100;

    /// @notice Default treasury (HookSwap treasury / fee-receiver).
    address public constant DEFAULT_TREASURY = 0x011d438E3eb3fce848950859591ec037C6529E13;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Protocol fee in basis points, taken from the OUTPUT token.
    ///         Defaults to 20 bps (0.2%).
    uint256 public feeBps = 20;

    /// @notice Recipient of the protocol fee.
    address public treasury;

    /// @notice Allowlist of DEX router targets that a swap plan may call.
    mapping(address router => bool allowed) public allowedRouter;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @param srcToken     ERC20 pulled from the user.
    /// @param dstToken     ERC20 delivered to the receiver.
    /// @param amountIn     Total srcToken to pull from the user.
    /// @param minAmountOut Minimum dstToken the receiver must get AFTER the
    ///                     protocol fee. Slippage / fee protection; reverts if
    ///                     not met.
    /// @param receiver     Recipient of the output (and any src refund dust).
    struct SwapDescription {
        address srcToken;
        address dstToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address receiver;
    }

    /// @param target      DEX router to call. MUST be allowlisted, and MUST NOT
    ///                    be the srcToken, dstToken, Permit2, or this contract.
    /// @param inputToken  Token this leg consumes (srcToken, or an intermediate
    ///                    produced by an earlier leg). Approved to `target`.
    /// @param inputAmount Exact amount of `inputToken` approved to `target` for
    ///                    this leg (approval zeroed immediately after).
    /// @param data        Calldata to invoke on `target` (built by the SOR).
    struct Call {
        address target;
        address inputToken;
        uint256 inputAmount;
        bytes data;
    }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Swapped(
        address indexed user,
        address indexed srcToken,
        address indexed dstToken,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        address receiver
    );
    event FeeCollected(address indexed token, uint256 amount, address indexed treasury);
    event RouterAllowlistUpdated(address indexed router, bool allowed);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event FeeUpdated(uint256 previousFeeBps, uint256 newFeeBps);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error IdenticalTokens();
    error ZeroAmountIn();
    error EmptyPlan();
    error RouterNotAllowed(address target);
    error ForbiddenTarget(address target);
    error ZeroInputToken();
    error CallFailed(uint256 index);
    error NoOutput();
    error InsufficientOutput(uint256 got, uint256 wanted);
    error FeeTooHigh(uint256 feeBps);
    error PermitTokenMismatch();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param initialOwner   Owner (allowlist + treasury + fee admin).
    /// @param initialTreasury Fee recipient. Pass address(0) to use DEFAULT_TREASURY.
    constructor(address initialOwner, address initialTreasury) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        treasury = initialTreasury == address(0) ? DEFAULT_TREASURY : initialTreasury;
        emit TreasuryUpdated(address(0), treasury);
    }

    // ---------------------------------------------------------------------
    // Swap entrypoints
    // ---------------------------------------------------------------------

    /// @notice Execute a cross-DEX swap plan, pulling input via a standard
    ///         ERC20 allowance the user has granted to THIS contract.
    /// @dev    Requires `srcToken.approve(aggregator, amountIn)` beforehand.
    function swap(SwapDescription calldata desc, Call[] calldata calls)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        _validate(desc, calls);
        // Pull input from the user via a pre-granted allowance.
        IERC20(desc.srcToken).safeTransferFrom(msg.sender, address(this), desc.amountIn);
        amountOut = _execute(desc, calls, msg.sender);
    }

    /// @notice Execute a cross-DEX swap plan, pulling input via Permit2
    ///         SignatureTransfer (no prior ERC20 approval to this contract).
    /// @dev    `permit.permitted.token` must equal `desc.srcToken` and the
    ///         requested amount is `desc.amountIn`. Funds are transferred
    ///         directly from the user to this contract by Permit2.
    function swapWithPermit2(
        SwapDescription calldata desc,
        Call[] calldata calls,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant returns (uint256 amountOut) {
        _validate(desc, calls);
        // Bind the permit to exactly this swap's input token + amount.
        if (permit.permitted.token != desc.srcToken) revert PermitTokenMismatch();
        PERMIT2.permitTransferFrom(
            permit,
            IPermit2.SignatureTransferDetails({ to: address(this), requestedAmount: desc.amountIn }),
            msg.sender,
            signature
        );
        amountOut = _execute(desc, calls, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Core execution
    // ---------------------------------------------------------------------

    function _validate(SwapDescription calldata desc, Call[] calldata calls) internal pure {
        if (desc.srcToken == address(0) || desc.dstToken == address(0)) revert ZeroAddress();
        if (desc.receiver == address(0)) revert ZeroAddress();
        if (desc.srcToken == desc.dstToken) revert IdenticalTokens();
        if (desc.amountIn == 0) revert ZeroAmountIn();
        if (calls.length == 0) revert EmptyPlan();
    }

    /// @dev Assumes `desc.amountIn` of `srcToken` has already been pulled into
    ///      this contract. Executes the plan, skims the fee, forwards output,
    ///      and refunds unspent src input.
    function _execute(SwapDescription calldata desc, Call[] calldata calls, address user)
        internal
        returns (uint256 amountOut)
    {
        // Baselines measured AFTER the input pull. Any src above `srcBaseline`
        // (i.e. its pre-swap balance) is unspent input to refund; any dst gained
        // above `dstBefore` is genuine swap output.
        uint256 dstBefore = IERC20(desc.dstToken).balanceOf(address(this));
        // srcBaseline is the balance the contract should be left with = whatever
        // it held before this swap (normally 0). We pulled amountIn on top of it.
        uint256 srcBalanceNow = IERC20(desc.srcToken).balanceOf(address(this));
        uint256 srcBaseline = srcBalanceNow > desc.amountIn ? srcBalanceNow - desc.amountIn : 0;

        uint256 len = calls.length;
        for (uint256 i = 0; i < len; ++i) {
            Call calldata c = calls[i];

            // (a) Only owner-allowlisted routers may be called.
            if (!allowedRouter[c.target]) revert RouterNotAllowed(c.target);
            // (c) A leg may never target the src/dst tokens, Permit2, or self —
            //     this is what stops a crafted call from pulling other users'
            //     approved balances via transferFrom.
            if (
                c.target == desc.srcToken || c.target == desc.dstToken || c.target == address(PERMIT2)
                    || c.target == address(this)
            ) {
                revert ForbiddenTarget(c.target);
            }
            if (c.inputToken == address(0)) revert ZeroInputToken();

            // (b) Exact, transient approval for this leg only.
            IERC20(c.inputToken).forceApprove(c.target, c.inputAmount);

            // Routers are always called with 0 native value (ERC20-only executor).
            (bool ok, ) = c.target.call(c.data);
            if (!ok) revert CallFailed(i);

            // Zero the approval so no standing allowance survives the call.
            IERC20(c.inputToken).forceApprove(c.target, 0);
        }

        // (f) Output = measured balance increase of dstToken.
        uint256 dstAfter = IERC20(desc.dstToken).balanceOf(address(this));
        uint256 received = dstAfter - dstBefore;
        if (received == 0) revert NoOutput();

        // Skim protocol fee from the output token.
        uint256 fee = (received * feeBps) / BPS_DENOMINATOR;
        amountOut = received - fee;

        // Enforce user's minimum AFTER fee.
        if (amountOut < desc.minAmountOut) revert InsufficientOutput(amountOut, desc.minAmountOut);

        if (fee > 0) {
            IERC20(desc.dstToken).safeTransfer(treasury, fee);
            emit FeeCollected(desc.dstToken, fee, treasury);
        }
        IERC20(desc.dstToken).safeTransfer(desc.receiver, amountOut);

        // (e) Refund unspent src input (dust) down to the pre-swap baseline.
        uint256 srcEnd = IERC20(desc.srcToken).balanceOf(address(this));
        if (srcEnd > srcBaseline) {
            IERC20(desc.srcToken).safeTransfer(desc.receiver, srcEnd - srcBaseline);
        }

        emit Swapped(user, desc.srcToken, desc.dstToken, desc.amountIn, amountOut, fee, desc.receiver);
    }

    // ---------------------------------------------------------------------
    // Owner administration
    // ---------------------------------------------------------------------

    /// @notice Allow or disallow a DEX router as a legal swap-plan target.
    /// @dev    Only allowlist trusted DEX routers. NEVER allowlist a token,
    ///         Permit2, a generic multicall/permit-forwarder, or this contract.
    function setRouterAllowed(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        allowedRouter[router] = allowed;
        emit RouterAllowlistUpdated(router, allowed);
    }

    /// @notice Batch variant of {setRouterAllowed}.
    function setRoutersAllowed(address[] calldata routers, bool allowed) external onlyOwner {
        uint256 len = routers.length;
        for (uint256 i = 0; i < len; ++i) {
            if (routers[i] == address(0)) revert ZeroAddress();
            allowedRouter[routers[i]] = allowed;
            emit RouterAllowlistUpdated(routers[i], allowed);
        }
    }

    /// @notice Update the fee recipient.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Update the protocol fee (bps). Capped at MAX_FEE_BPS (1%).
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps);
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    // ---------------------------------------------------------------------
    // Rescue (owner) — for tokens accidentally sent directly to the contract.
    // ---------------------------------------------------------------------

    /// @notice Rescue ERC20 tokens accidentally transferred to this contract.
    /// @dev    The contract is designed to hold no funds between swaps; this is
    ///         a safety valve for stray/airdropped tokens. Cannot be used mid-
    ///         swap (nonReentrant) and only the owner can call it.
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }
}
