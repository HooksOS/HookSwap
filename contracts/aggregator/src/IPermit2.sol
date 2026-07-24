// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPermit2 (SignatureTransfer subset)
/// @notice Minimal interface for the canonical Permit2 contract deployed at
///         0x000000000022D473030F116dDEE9F6B43aC78BA3 on every HookSwap chain.
///         Only the single-token signature-transfer path is used by the
///         aggregator; the AllowanceTransfer surface is intentionally omitted.
interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    /// @notice Transfers `transferDetails.requestedAmount` of `permit.permitted.token`
    ///         from `owner` to `transferDetails.to`, authorised by `owner`'s off-chain
    ///         EIP-712 `signature`. Reverts if the requested amount exceeds the signed
    ///         permitted amount, the nonce is spent, or the deadline has passed.
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}
