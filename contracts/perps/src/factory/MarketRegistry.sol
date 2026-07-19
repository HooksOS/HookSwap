// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MarketRegistry
 * @notice Enumerable directory of HookSwapPerps self-service markets. The factory
 *         registers each market it creates; the frontend + perps-engine read this
 *         to list markets, provision oracle/matcher lanes, and render tier badges.
 *         The platform owner can force a market's status (e.g. PAUSED / DELISTED)
 *         as the kill switch described in SELF_SERVICE_SPEC.md.
 */
contract MarketRegistry is Ownable {
    enum Tier {
        CURATED,
        PERMISSIONLESS
    }
    enum Status {
        ACTIVE,
        PAUSED,
        DELISTED
    }

    struct MarketInfo {
        address market; // the per-market Settlement instance
        address creator; // fee beneficiary / launcher
        address collateral; // collateral token
        bytes32 marketId; // human label, e.g. keccak256("BTC-PERP")
        Tier tier;
        Status status;
        uint256 createdAt;
    }

    address public factory;
    MarketInfo[] public markets;
    mapping(address => uint256) public indexOf; // market => markets[] index + 1 (0 = absent)

    event FactorySet(address indexed factory);
    event MarketRegistered(
        uint256 indexed id,
        address indexed market,
        address indexed creator,
        bytes32 marketId,
        Tier tier
    );
    event StatusChanged(address indexed market, Status status);

    error NotFactory();
    error UnknownMarket();
    error AlreadyRegistered();

    constructor() Ownable(msg.sender) {}

    function setFactory(address _factory) external onlyOwner {
        factory = _factory;
        emit FactorySet(_factory);
    }

    function register(
        address market,
        address creator,
        address collateral,
        bytes32 marketId,
        Tier tier
    ) external returns (uint256 id) {
        if (msg.sender != factory) revert NotFactory();
        if (indexOf[market] != 0) revert AlreadyRegistered();
        markets.push(
            MarketInfo({
                market: market,
                creator: creator,
                collateral: collateral,
                marketId: marketId,
                tier: tier,
                status: Status.ACTIVE,
                createdAt: block.timestamp
            })
        );
        id = markets.length - 1;
        indexOf[market] = id + 1;
        emit MarketRegistered(id, market, creator, marketId, tier);
    }

    /// Platform kill switch: pause / delist a market (spec §3, §5).
    function setStatus(address market, Status status) external onlyOwner {
        uint256 idx = indexOf[market];
        if (idx == 0) revert UnknownMarket();
        markets[idx - 1].status = status;
        emit StatusChanged(market, status);
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    /// Paginated read for the frontend/indexer.
    function getMarkets(uint256 start, uint256 count) external view returns (MarketInfo[] memory page) {
        uint256 n = markets.length;
        if (start >= n) return new MarketInfo[](0);
        uint256 end = start + count;
        if (end > n) end = n;
        page = new MarketInfo[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = markets[i];
        }
    }
}
