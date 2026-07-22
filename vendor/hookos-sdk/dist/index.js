import { decodeEventLog, pad, toHex, parseEther, getContractAddress, formatEther, createPublicClient, http, keccak256, concat, getAddress, slice } from 'viem';
import { mainnet, bsc, base } from 'viem/chains';

// src/client.ts

// src/addresses.ts
var ZERO = "0x0000000000000000000000000000000000000000";
var ADDRESSES = {
  // Base mainnet (primary chain)
  8453: {
    tokenFactory: "0x9B3d636C27AD4CDEBFbE1F182B2b63F66Be7adE5",
    hookRegistry: "0x467A8Ab4A9B65D8Da151F402021b17A147C058c5",
    hookManager: "0x96c5E38362f86E52389E15a86247fB7326503c8d",
    feeRouter: "0x64E3167b2B4eA1b8e3DdCaFe66a5b435BE7cD75f",
    arena: "0x47C839295754307E635DC6bEf89856267932dD38",
    events: "0x2c34ee38d96FBC890d341D80610375657594EFCc",
    bondingCurve: "0x3C4b0F2D3d5bBdf4E0B323f0a8Eec7B02Cce6d40",
    swapRouter: "0x1106A0257bbB2f7950f5bcf366e966D24c6F5cDd",
    poolFactory: "0xEE71e51e757a3B36F027400CDb7182710564654A",
    hookRevenueVault: "0xA1B01d969D39647e5C98416779920d844a1FA961",
    hookOsNft: "0xA50901D97ec77362f8B19464DAbf76B39128fC98",
    hookLicenseNft: "0xe0189E7E729fB8dCfA4799171620335f08Cc4AE5",
    battlePass: "0x55eAd32A8B5343e085B92eA087df0FBE60386fF7",
    questSystem: "0x58235F1112de75606D18ECFD6a136D3745cB70A7",
    clanSystem: "0xEdC0a9BEC4c038CaeEB3CEeeF6B86235397AA8e6",
    launchWars: "0xA1A348a120BB2Fc10059870183db9a513C6A804d",
    reputationSystem: "0x47A66A65fC90349EaaFB1D51c18B61a2d4FFB91d",
    arenaV2: "0xa29FEbD83f0977F39ed29221E6235dA10Cb5b35c",
    analyticsEmitter: "0xd72600d7105d997e495844e30df92cd296b911e4",
    launchController: "0x7eA1c5A725cc4f9ECaDbF706084A90b219e9CB38",
    donationRouter: "0xF5a06e00d26F1b06B76fAAcBc2b5BB177598B1b0",
    extensionRegistry: "0xCE9a474B817E7A102F922F26188A14515aA47f6f",
    feedBoostAuction: "0xaD31291Ff64a26D2eE5346A3c96b07f6cEe4b442"
  },
  // Robinhood Chain
  4663: {
    tokenFactory: "0x3E9E09C4759553e38a10AdED3E0f3f46b3CdF162",
    hookRegistry: "0x58F994034E465dA801Be25c2a411b198a03A4109",
    hookManager: "0x6710578E596B74A46b2A200899aB6de06c9eE7C2",
    feeRouter: "0x14C9e52be5A5a148CDe2E4336Fee1c7a3338ff17",
    arena: "0xBFfcb23fD7dB0bd9DA801390d4BfAe33dE665ef7",
    events: "0x509C3e1E9837DF4B89B9FA1f14C527CD92B652Fe",
    bondingCurve: "0x93f35a190E6B7ed05E7bBAb78199720C0c849dDE",
    swapRouter: "0x37F655bdf7C89E17eC1B6A143a572D277b59703C",
    poolFactory: "0xF2F1C1D5089995c55C9Bf0395ebb70EBBF17b61D",
    hookRevenueVault: "0x2542575fF17770c5743F12A8a6705A63206de361",
    hookOsNft: ZERO,
    hookLicenseNft: ZERO,
    battlePass: ZERO,
    questSystem: ZERO,
    clanSystem: ZERO,
    launchWars: ZERO,
    reputationSystem: ZERO,
    arenaV2: ZERO,
    analyticsEmitter: ZERO,
    launchController: ZERO,
    donationRouter: ZERO,
    extensionRegistry: ZERO,
    feedBoostAuction: ZERO
  },
  // MegaETH
  4326: {
    tokenFactory: "0x9Bb58abC4A41eaC5692F42Dc59e15b0efb92af81",
    hookRegistry: "0xE1Ecb2b6bB656FF32C886ff41dA59A159EFF41f0",
    hookManager: "0xa9F36a3BaF19b21A764F837e0dF49DFE203636B7",
    feeRouter: "0x69A8C492056F5f58e19d5DA65EBd1869BA24815b",
    arena: "0x30801EAb4C458cF8795eED77cAe5e3F422678347",
    events: "0x77FbF854c2f376280599f5277A1A0c1D1B736Edc",
    bondingCurve: "0x6A2fAa5Da2B9F1515661f18160C0A0d584c0AC15",
    swapRouter: "0x2850C29ACBBe98b1b2C57ac0B673184876266f51",
    poolFactory: "0x1106A0257bbB2f7950f5bcf366e966D24c6F5cDd",
    hookRevenueVault: "0x97e7B6e7F995F45bc20c35ACA02B2CD400864dF9",
    hookOsNft: "0x2Ff14C5681eCAada2B90BC1F0EfF081F7bac8096",
    hookLicenseNft: "0xFEE62e423b3c4bE75315CeCeF08Eb6Ae8d4F4293",
    battlePass: "0xF42c7658A6766f078487102Af20c7C0221c3866F",
    questSystem: "0xeCeDd98C8Fb52ee336e22375c0f8193c1253a2a1",
    clanSystem: "0x360E1FCEcACe39a7d96883e5Ae640DA6E88e6579",
    launchWars: "0xd16e3Ed4ABf1957100DC4063F179C0Ccb7dd895E",
    reputationSystem: "0xCD9Ec2C56fE1f561d63107f1ca9e2B5218e8284e",
    arenaV2: "0xbdfFc8B2db17fDE04D53916E03dCB07ad6D56266",
    analyticsEmitter: "0x4068Df92693a01A1811620076E479D545821fFa0",
    launchController: "0x75bD4983C60147217F3693cb7C45212a98CD3A1C",
    donationRouter: "0xCdC35BED68bE2aD6245D93F8D310408d4aB93167",
    extensionRegistry: "0x57Bd605a01DFF58F6CB1b19a1ddCc0274Dd0f528",
    feedBoostAuction: "0x55eAd32A8B5343e085B92eA087df0FBE60386fF7"
  },
  // HyperEVM
  999: {
    tokenFactory: "0x96c5E38362f86E52389E15a86247fB7326503c8d",
    hookRegistry: "0x64E3167b2B4eA1b8e3DdCaFe66a5b435BE7cD75f",
    hookManager: "0xC062c550b4abcbE8fa50DF05Ea353864d0E01262",
    feeRouter: "0x8DebEd7101B2e6577909fA07491F484fC2A8Ad2c",
    arena: "0x9B3d636C27AD4CDEBFbE1F182B2b63F66Be7adE5",
    events: "0x47C839295754307E635DC6bEf89856267932dD38",
    bondingCurve: "0x93f35a190E6B7ed05E7bBAb78199720C0c849dDE",
    swapRouter: "0x37F655bdf7C89E17eC1B6A143a572D277b59703C",
    poolFactory: "0xF2F1C1D5089995c55C9Bf0395ebb70EBBF17b61D",
    hookRevenueVault: "0x5c977d2fF0b8aD13ca0AbF954A219E31CF049C60",
    hookOsNft: ZERO,
    hookLicenseNft: ZERO,
    battlePass: ZERO,
    questSystem: ZERO,
    clanSystem: ZERO,
    launchWars: ZERO,
    reputationSystem: ZERO,
    arenaV2: ZERO,
    analyticsEmitter: ZERO,
    launchController: ZERO,
    donationRouter: "0xbA57f44D8C90780530c7ea91c999389F77f09b43",
    extensionRegistry: "0x1F15e5Db9670F76a0C863A1D87DFaA037C82B602",
    feedBoostAuction: ZERO
  },
  // BNB Chain
  56: {
    tokenFactory: "0x60DfFA6940696e8f2dF997b570D9FEACC5eb1Ef7",
    hookRegistry: "0x0dDE71F9711693cABB46FAd461e9F0cB27B96f53",
    hookManager: "0x36f61a66B00ED7248954A494574E6171CFc959a2",
    feeRouter: "0x1a4BBd3cB922Ffd6167f0a75fd037A3760d63B63",
    arena: "0x2eF43362A9aA71DD23Ba336275E976ac300F4864",
    events: "0x071668123E129D665b756EdFFAE713B441cB69d6",
    bondingCurve: "0xbb141A22B4cAef996052b2ecC9F9ef2Cde259bcA",
    swapRouter: "0x4Cd8fd69F93916D6F8793Bdf4418206A172af66F",
    poolFactory: "0x0d04627b6eFc9f546702969fF1faBD7a9642886f",
    hookRevenueVault: "0xc841eF17b424B00A46C5acebDEEbE2976F168AC7",
    hookOsNft: "0x555f5c7e67826b860272fda6fce34Cd36e751F12",
    hookLicenseNft: "0x55931c3a1752365788180CDDeD47E030a104DF11",
    battlePass: "0xe79D1C0941E0448E3793afeA8dF0542c9B032343",
    questSystem: "0xD9Ff755b6113f80276fE36DCddF931084051FD68",
    clanSystem: "0x75bD4983C60147217F3693cb7C45212a98CD3A1C",
    launchWars: "0x9F5690a9128e4E80E9D08F0415DD804d5f7f7168",
    reputationSystem: "0x656e4C8d87780F8b0ba0dB45b9834a25b5200606",
    arenaV2: "0xb1D9aca82B1F011F7Dc37c704F70d49DF048fe3b",
    analyticsEmitter: "0xC0d94a99398b0b3C14971F25F13445Ef3c7fb63c",
    launchController: "0xCdC35BED68bE2aD6245D93F8D310408d4aB93167",
    donationRouter: "0x5B6fF84d8b03c75a3D115cdaF7ee101fa6F1cb92",
    extensionRegistry: "0x6627B03b457Fa41d4C00f0A934aF3D3FFC882038",
    feedBoostAuction: "0xdc9a19ea23e19944c448ED77079cf64396B59610"
  },
  // Ethereum
  1: {
    tokenFactory: "0xa7d00760693CEc4F8c622EeD44C786a190FbA342",
    hookRegistry: "0x93f35a190E6B7ed05E7bBAb78199720C0c849dDE",
    hookManager: "0x677AEE8e641701D68CaD4FB7Ca68AED78DA277c7",
    feeRouter: "0x37F655bdf7C89E17eC1B6A143a572D277b59703C",
    arena: "0x1a4BBd3cB922Ffd6167f0a75fd037A3760d63B63",
    events: "0x0dDE71F9711693cABB46FAd461e9F0cB27B96f53",
    bondingCurve: "0xc841eF17b424B00A46C5acebDEEbE2976F168AC7",
    swapRouter: "0x071668123E129D665b756EdFFAE713B441cB69d6",
    poolFactory: "0xcDfD3B997EC5A2F9CA59955d9aCE30eD8dFbFEff",
    hookRevenueVault: "0x36f61a66B00ED7248954A494574E6171CFc959a2",
    hookOsNft: ZERO,
    hookLicenseNft: ZERO,
    battlePass: ZERO,
    questSystem: ZERO,
    clanSystem: ZERO,
    launchWars: ZERO,
    reputationSystem: ZERO,
    arenaV2: ZERO,
    analyticsEmitter: ZERO,
    launchController: ZERO,
    donationRouter: ZERO,
    extensionRegistry: ZERO,
    feedBoostAuction: ZERO
  }
};
var HOOKOS_V3_CHAIN_ID = 4663;
var HOOKOS_V3_ADDRESSES_BY_CHAIN = {
  // Robinhood Chain (origin — full suite incl. buyback + $HOOK)
  4663: {
    launcher: "0x9B8d992704ddf38729535A641502bcc55734e0B8",
    feeVault: "0x2974cE6341067398A5C1E6c0C14F99ED1C3122EF",
    buyback: "0x01EB2F68C31Ae70655807552fbDf970f1851CA50",
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    hook: "0x85d4e6F147BFb5729378E451F32cf5287dE75f97"
  },
  // Base
  8453: {
    launcher: "0x094E2b0b5B750441Fc36A72B4754F6833231D76e",
    feeVault: "0x46d6b8168a43D908F306C243C30f4Aa035348B11",
    buyback: ZERO,
    weth: "0x4200000000000000000000000000000000000006",
    hook: ZERO
  },
  // BNB Chain (Uniswap V3 + PancakeSwap V3)
  56: {
    launcher: "0xaB058c222baae520cc83440F941628abF2F876fD",
    feeVault: "0x258093F7706E8b12D335149d8Df6AeDfa7E6D23A",
    buyback: ZERO,
    weth: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    // WBNB
    hook: ZERO
  },
  // Ethereum
  1: {
    launcher: "0xCdC35BED68bE2aD6245D93F8D310408d4aB93167",
    feeVault: "0xC0d94a99398b0b3C14971F25F13445Ef3c7fb63c",
    buyback: ZERO,
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    hook: ZERO
  },
  // MegaETH
  4326: {
    launcher: "0x528Bcecff5DA16cE65C198fBe42dA55A0088d4c2",
    feeVault: "0x710cd7173AdF70ff50428590210f746ac54De816",
    buyback: ZERO,
    weth: "0x4200000000000000000000000000000000000006",
    hook: ZERO
  },
  // HyperEVM (HookSwap V3 only)
  999: {
    launcher: "0x2dB1b1e2123c3d61B0cAfE4aF5864E4FAB3a5F74",
    feeVault: "0x502AA94344a5FCA6766C3fF382f1CdD435A7e6Ef",
    buyback: ZERO,
    weth: "0x2ebb5c574a3944a3E476E2Bb9D1d5B969CFb8237",
    // WHYPE
    hook: ZERO
  }
};
var HOOKOS_V3_ADDRESSES = HOOKOS_V3_ADDRESSES_BY_CHAIN[4663];
var HOOKOS_V3_SUPPORTED_CHAIN_IDS = [4663, 8453, 56, 1, 4326, 999];
function getHookOSV3Addresses(chainId) {
  const a = HOOKOS_V3_ADDRESSES_BY_CHAIN[chainId];
  if (!a || a.launcher === ZERO) return null;
  return a;
}
var STOCK_REWARD_CHAIN_ID = 4663;
var STOCK_REWARD_ADDRESSES = {
  launcherV4: "0x11B223C5a979267b10aE61761CB5b0bD00448Dda",
  launcherV2: "0x8FcdCfa43e78Cbb91592F1503893d12E19d271ef",
  vault: "0x45720b33e8A54F2A8e3B7Cf7a54c23081DbBF948",
  distributor: "0xf344e52182B02125338448B3a89DcD83A3aEc013",
  taxHook: "0x45F983076500a670EB12B2F3Aa6863d53dC880CC",
  wethUsdAdapter: "0x0FCe83FBcbb83286ee18A04d95a5a06A5961Ca20",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  bondingCurve: "0x93f35a190E6B7ed05E7bBAb78199720C0c849dDE"
};
function getStockRewardAddresses(chainId) {
  if (chainId === STOCK_REWARD_CHAIN_ID) return STOCK_REWARD_ADDRESSES;
  return null;
}
var QUICK_LAUNCH_CHAIN_ID = 4663;
var QUICK_LAUNCH_ADDRESSES = {
  launchpad: "0x316022a060284b84D6711a203e2578eE452c7858",
  launchHook: "0xA71B7482439C4f147abFe23cBa5312770f31C0c4",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  bondingCurve: "0x93f35a190E6B7ed05E7bBAb78199720C0c849dDE"
};
function getQuickLaunchAddresses(chainId) {
  if (chainId === QUICK_LAUNCH_CHAIN_ID) return QUICK_LAUNCH_ADDRESSES;
  return null;
}
function getAddresses(chainId = 8453) {
  const addresses = ADDRESSES[chainId];
  if (!addresses) {
    return ADDRESSES[8453];
  }
  return addresses;
}

// src/errors.ts
var HookOSError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "HookOSError";
  }
};
var WalletRequiredError = class extends HookOSError {
  constructor(operation) {
    super(`Wallet client required for write operation: ${operation}`);
    this.name = "WalletRequiredError";
  }
};
var TransactionError = class extends HookOSError {
  txHash;
  reason;
  constructor(message, opts) {
    super(message);
    this.name = "TransactionError";
    this.txHash = opts?.txHash;
    this.reason = opts?.reason;
  }
};
var ChainError = class extends HookOSError {
  constructor(chainId) {
    super(`Unsupported chain: ${chainId}. Supported chains: 8453 (Base), 999 (HyperEVM)`);
    this.name = "ChainError";
  }
};
var ContractCallError = class extends HookOSError {
  contractName;
  method;
  constructor(contractName, method, message) {
    super(`${contractName}.${method}: ${message}`);
    this.name = "ContractCallError";
    this.contractName = contractName;
    this.method = method;
  }
};
var ValidationError = class extends HookOSError {
  field;
  constructor(field, message) {
    super(`Validation error on "${field}": ${message}`);
    this.name = "ValidationError";
    this.field = field;
  }
};
var IndexerError = class extends HookOSError {
  statusCode;
  constructor(message, statusCode) {
    super(message);
    this.name = "IndexerError";
    this.statusCode = statusCode;
  }
};

// src/abis/TokenFactory.ts
var TokenFactoryABI = [
  {
    "name": "launchFee",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "launchFeeUsd",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "effectiveLaunchFee",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "nativeUsdFeed",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ]
  },
  {
    "name": "getTokenCount",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getCreatorTokenCount",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "creator",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "allTokens",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ]
  },
  {
    "name": "tokens",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "tokenAddress",
        "type": "address"
      },
      {
        "name": "creator",
        "type": "address"
      },
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "symbol",
        "type": "string"
      },
      {
        "name": "initialSupply",
        "type": "uint256"
      },
      {
        "name": "launchFee",
        "type": "uint256"
      },
      {
        "name": "createdAt",
        "type": "uint64"
      }
    ]
  },
  {
    "name": "paused",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ]
  },
  {
    "name": "createToken",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "symbol",
        "type": "string"
      },
      {
        "name": "initialSupply",
        "type": "uint256"
      },
      {
        "name": "metadataURI",
        "type": "string"
      }
    ],
    "outputs": [
      {
        "name": "tokenAddress",
        "type": "address"
      }
    ]
  },
  {
    "name": "createTokenAndCurve",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "symbol",
        "type": "string"
      },
      {
        "name": "initialSupply",
        "type": "uint256"
      },
      {
        "name": "metadataURI",
        "type": "string"
      },
      {
        "name": "useExternalDex",
        "type": "bool"
      }
    ],
    "outputs": [
      {
        "name": "tokenAddress",
        "type": "address"
      }
    ]
  },
  {
    "name": "setLaunchFeeUsd",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "feeUsd",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "setLaunchFee",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "fee",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "TokenCreated",
    "type": "event",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true
      },
      {
        "name": "name",
        "type": "string",
        "indexed": false
      },
      {
        "name": "symbol",
        "type": "string",
        "indexed": false
      },
      {
        "name": "initialSupply",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  }
];

// src/modules/tokens.ts
var ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
var TokenModule = class {
  constructor(address, publicClient, walletClient) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  address;
  publicClient;
  walletClient;
  /**
   * Get the total number of tokens created via the factory.
   */
  async getCount() {
    return this.publicClient.readContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "getTokenCount"
    });
  }
  /**
   * Get the current launch fee (in wei).
   */
  async getLaunchFee() {
    return this.publicClient.readContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "launchFee"
    });
  }
  /**
   * Get the configured launch fee in USD (1e18-scaled). v2 USD-pegging.
   * On non-ETH chains the effective native fee tracks this USD value at the live price.
   */
  async getLaunchFeeUsd() {
    return this.publicClient.readContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "launchFeeUsd"
    });
  }
  /**
   * Get the effective launch fee in native currency (wei), derived from the USD
   * target at the live native/USD price. This is the amount `create()` must send.
   * v2 — prefer this over the legacy fixed `launchFee`.
   */
  async getEffectiveLaunchFee() {
    return this.publicClient.readContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "effectiveLaunchFee"
    });
  }
  /**
   * Get the number of tokens created by a specific address.
   */
  async getCreatorCount(creator) {
    return this.publicClient.readContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "getCreatorTokenCount",
      args: [creator]
    });
  }
  /**
   * Get the token address at a specific index in the factory.
   */
  async getTokenAddress(index) {
    return this.publicClient.readContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "allTokens",
      args: [index]
    });
  }
  /**
   * Fetch token info by its deployed address.
   */
  async get(tokenAddress) {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "tokens",
      args: [tokenAddress]
    });
    const [addr, creator, name, symbol, initialSupply, launchFee, createdAt] = result;
    if (addr === ZERO_ADDRESS) {
      throw new ContractCallError("TokenFactory", "tokens", `Token not found: ${tokenAddress}`);
    }
    return {
      tokenAddress: addr,
      creator,
      name,
      symbol,
      initialSupply,
      launchFee,
      createdAt: Number(createdAt)
    };
  }
  /**
   * Fetch all tokens registered in the factory.
   * Optionally limit the number of tokens to fetch.
   */
  async list(limit) {
    const count = await this.getCount();
    const max = limit ? BigInt(Math.min(limit, Number(count))) : count;
    const tokens = [];
    for (let i = 0n; i < max; i++) {
      try {
        const addr = await this.getTokenAddress(i);
        const info = await this.get(addr);
        tokens.push(info);
      } catch {
      }
    }
    return tokens;
  }
  /**
   * Check if the factory contract is paused.
   */
  async isPaused() {
    return this.publicClient.readContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "paused"
    });
  }
  /**
   * Create a new HookOS token via the TokenFactory.
   * Requires a wallet client. If `params.value` is not set, the on-chain `launchFee` is queried.
   */
  async create(params) {
    if (!this.walletClient) throw new WalletRequiredError("tokens.create");
    let value = params.value;
    if (value === void 0) {
      try {
        value = await this.getEffectiveLaunchFee();
      } catch {
        value = await this.getLaunchFee();
      }
    }
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("tokens.create (no account)");
    const useExternalDex = params.useExternalDex ?? true;
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: TokenFactoryABI,
      functionName: "createTokenAndCurve",
      args: [params.name, params.symbol, params.initialSupply, params.metadataURI, useExternalDex],
      value,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    let tokenAddress = ZERO_ADDRESS;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: TokenFactoryABI,
          data: log.data,
          topics: log.topics
        });
        if (decoded.eventName === "TokenCreated") {
          tokenAddress = decoded.args.token;
          break;
        }
      } catch {
      }
    }
    if (tokenAddress === ZERO_ADDRESS) {
      throw new ContractCallError("TokenFactory", "createTokenAndCurve", "TokenCreated event not found in receipt");
    }
    const txResult = {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
    return { tokenAddress, txResult };
  }
};

// src/abis/HookRegistry.ts
var HookRegistryABI = [
  {
    "name": "registrationFee",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "registrationFeeUsd",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "effectiveRegistrationFee",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "nativeUsdFeed",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ]
  },
  {
    "name": "getHookCount",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "hooks",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "author",
        "type": "address"
      },
      {
        "name": "implementation",
        "type": "address"
      },
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "category",
        "type": "string"
      },
      {
        "name": "metadataURI",
        "type": "string"
      },
      {
        "name": "installs",
        "type": "uint256"
      },
      {
        "name": "totalRating",
        "type": "uint256"
      },
      {
        "name": "ratingCount",
        "type": "uint256"
      },
      {
        "name": "revenue",
        "type": "uint256"
      },
      {
        "name": "verified",
        "type": "bool"
      },
      {
        "name": "active",
        "type": "bool"
      },
      {
        "name": "createdAt",
        "type": "uint64"
      }
    ]
  },
  {
    "name": "hookIds",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ]
  },
  {
    "name": "getAverageRating",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "hookId",
        "type": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "paused",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ]
  },
  {
    "name": "registerHook",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "category",
        "type": "string"
      },
      {
        "name": "metadataURI",
        "type": "string"
      },
      {
        "name": "implementation",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "hookId",
        "type": "bytes32"
      }
    ]
  },
  {
    "name": "rateHook",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "hookId",
        "type": "bytes32"
      },
      {
        "name": "rating",
        "type": "uint8"
      }
    ],
    "outputs": []
  },
  {
    "name": "recordInstall",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "hookId",
        "type": "bytes32"
      }
    ],
    "outputs": []
  },
  {
    "name": "setRegistrationFeeUsd",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "feeUsd",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "setRegistrationFee",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "fee",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "HookRegistered",
    "type": "event",
    "inputs": [
      {
        "name": "hookId",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "author",
        "type": "address",
        "indexed": true
      },
      {
        "name": "name",
        "type": "string",
        "indexed": false
      },
      {
        "name": "implementation",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  }
];

// src/abis/HookManager.ts
var HookManagerABI = [
  {
    name: "maxHooksPerToken",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "defaultGasLimit",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "getTokenHookCount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "getActiveHooks",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "hookId", type: "bytes32" },
          { name: "hookImpl", type: "address" },
          { name: "hookPoint", type: "uint8" },
          { name: "active", type: "bool" },
          { name: "gasLimit", type: "uint256" },
          { name: "attachedAt", type: "uint64" }
        ]
      }
    ]
  },
  {
    name: "hasHook",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "bytes32" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "attachHook",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "hookId", type: "bytes32" },
      { name: "hookImpl", type: "address" },
      { name: "hookPoint", type: "uint8" },
      { name: "gasLimit", type: "uint256" }
    ],
    outputs: []
  },
  {
    name: "detachHook",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "hookId", type: "bytes32" }
    ],
    outputs: []
  },
  {
    name: "HookAttached",
    type: "event",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "hookId", type: "bytes32", indexed: true },
      { name: "hookPoint", type: "uint8", indexed: false }
    ]
  },
  {
    name: "HookDetached",
    type: "event",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "hookId", type: "bytes32", indexed: true }
    ]
  }
];

// src/modules/hooks.ts
var ZERO_ADDRESS2 = "0x0000000000000000000000000000000000000000";
var HookModule = class {
  constructor(registryAddress, managerAddress, publicClient, walletClient) {
    this.registryAddress = registryAddress;
    this.managerAddress = managerAddress;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  registryAddress;
  managerAddress;
  publicClient;
  walletClient;
  /**
   * Get the total number of registered hooks.
   */
  async getCount() {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: HookRegistryABI,
      functionName: "getHookCount"
    });
  }
  /**
   * Get the current registration fee (in wei).
   */
  async getRegistrationFee() {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: HookRegistryABI,
      functionName: "registrationFee"
    });
  }
  /**
   * Get the configured hook registration fee in USD (1e18-scaled). v2 USD-pegging.
   */
  async getRegistrationFeeUsd() {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: HookRegistryABI,
      functionName: "registrationFeeUsd"
    });
  }
  /**
   * Get the effective registration fee in native currency (wei), derived from the
   * USD target at the live native/USD price. This is the amount `register()` must send.
   * v2 — prefer this over the legacy fixed `registrationFee`.
   */
  async getEffectiveRegistrationFee() {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: HookRegistryABI,
      functionName: "effectiveRegistrationFee"
    });
  }
  /**
   * Get detailed info for a specific hook by its hookId.
   */
  async get(hookId) {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: HookRegistryABI,
      functionName: "hooks",
      args: [hookId]
    });
    const [author, implementation, name, category, metadataURI, installs, totalRating, ratingCount, revenue, verified, active, createdAt] = result;
    if (author === ZERO_ADDRESS2) {
      throw new ContractCallError("HookRegistry", "hooks", `Hook not found: ${hookId}`);
    }
    let averageRating = 0;
    try {
      const avg = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: HookRegistryABI,
        functionName: "getAverageRating",
        args: [hookId]
      });
      averageRating = Number(avg) / 100;
    } catch {
    }
    return {
      hookId,
      author,
      implementation,
      name,
      category,
      metadataURI,
      installs,
      totalRating,
      ratingCount,
      revenue,
      verified,
      active,
      createdAt: Number(createdAt),
      averageRating
    };
  }
  /**
   * Get the hookId at a specific index.
   */
  async getHookId(index) {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: HookRegistryABI,
      functionName: "hookIds",
      args: [index]
    });
  }
  /**
   * Browse all registered hooks with optional filters.
   */
  async browse(filters) {
    const count = await this.getCount();
    const results = [];
    for (let i = 0n; i < count; i++) {
      const hookId = await this.getHookId(i);
      let info;
      try {
        info = await this.get(hookId);
      } catch {
        continue;
      }
      if (filters?.category !== void 0 && info.category !== filters.category) continue;
      if (filters?.verified !== void 0 && info.verified !== filters.verified) continue;
      if (filters?.active !== void 0 && info.active !== filters.active) continue;
      if (filters?.author !== void 0 && info.author.toLowerCase() !== filters.author.toLowerCase()) continue;
      results.push(info);
    }
    return results;
  }
  /**
   * List all active hook bindings for a given token.
   */
  async listBindings(token) {
    const bindings = await this.publicClient.readContract({
      address: this.managerAddress,
      abi: HookManagerABI,
      functionName: "getActiveHooks",
      args: [token]
    });
    return bindings.map((b) => ({
      hookId: b.hookId,
      hookImpl: b.hookImpl,
      hookPoint: Number(b.hookPoint),
      active: b.active,
      gasLimit: b.gasLimit,
      attachedAt: Number(b.attachedAt)
    }));
  }
  /**
   * Check if a token has a specific hook attached.
   */
  async hasHook(token, hookId) {
    return this.publicClient.readContract({
      address: this.managerAddress,
      abi: HookManagerABI,
      functionName: "hasHook",
      args: [token, hookId]
    });
  }
  /**
   * Register a new hook in the HookRegistry.
   * Requires a wallet client. Returns the generated hookId.
   */
  async register(params) {
    if (!this.walletClient) throw new WalletRequiredError("hooks.register");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("hooks.register (no account)");
    let value = params.value;
    if (value === void 0) {
      try {
        value = await this.getEffectiveRegistrationFee();
      } catch {
        value = await this.getRegistrationFee();
      }
    }
    const hash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: HookRegistryABI,
      functionName: "registerHook",
      args: [params.name, params.category, params.metadataURI, params.implementation],
      value,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: HookRegistryABI,
          data: log.data,
          topics: log.topics
        });
        if (decoded.eventName === "HookRegistered") {
          return decoded.args.hookId;
        }
      } catch {
      }
    }
    throw new ContractCallError("HookRegistry", "registerHook", "HookRegistered event not found in receipt");
  }
  /**
   * Attach a hook to a token via the HookManager.
   */
  async attach(params) {
    if (!this.walletClient) throw new WalletRequiredError("hooks.attach");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("hooks.attach (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.managerAddress,
      abi: HookManagerABI,
      functionName: "attachHook",
      args: [params.token, params.hookId, params.hookImpl, params.hookPoint, params.gasLimit ?? 0n],
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
  /**
   * Detach a hook from a token.
   */
  async detach(params) {
    if (!this.walletClient) throw new WalletRequiredError("hooks.detach");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("hooks.detach (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.managerAddress,
      abi: HookManagerABI,
      functionName: "detachHook",
      args: [params.token, params.hookId],
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
};

// src/abis/Arena.ts
var ArenaABI = [
  {
    name: "battleCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "protocolFeeBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "battles",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "pot", type: "uint256" },
      { name: "teamAPot", type: "uint256" },
      { name: "teamBPot", type: "uint256" },
      { name: "minWager", type: "uint256" },
      { name: "maxWager", type: "uint256" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "round", type: "uint16" },
      { name: "status", type: "uint8" },
      { name: "winner", type: "uint8" }
    ]
  },
  {
    name: "hasWagered",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "getBattleWagerCount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "placeWager",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "battleId", type: "uint256" },
      { name: "side", type: "uint8" }
    ],
    outputs: []
  },
  {
    name: "claimWinnings",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: []
  },
  {
    name: "createBattle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "minWager", type: "uint256" },
      { name: "maxWager", type: "uint256" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" }
    ],
    outputs: [{ name: "battleId", type: "uint256" }]
  },
  {
    name: "WagerPlaced",
    type: "event",
    inputs: [
      { name: "battleId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "side", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false }
    ]
  },
  {
    name: "WinningsClaimed",
    type: "event",
    inputs: [
      { name: "battleId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ]
  }
];

// src/modules/arena.ts
var ArenaModule = class {
  constructor(address, publicClient, walletClient) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  address;
  publicClient;
  walletClient;
  /**
   * Get the total number of battles created.
   */
  async getCount() {
    return this.publicClient.readContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "battleCount"
    });
  }
  /**
   * Get the protocol fee in basis points.
   */
  async getProtocolFeeBps() {
    return this.publicClient.readContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "protocolFeeBps"
    });
  }
  /**
   * Get detailed info for a battle by ID.
   */
  async getBattle(battleId) {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "battles",
      args: [BigInt(battleId)]
    });
    const [tokenA, tokenB, pot, teamAPot, teamBPot, minWager, maxWager, startTime, endTime, round, status, winner] = result;
    return {
      tokenA,
      tokenB,
      pot,
      teamAPot,
      teamBPot,
      minWager,
      maxWager,
      startTime: Number(startTime),
      endTime: Number(endTime),
      round: Number(round),
      status: Number(status),
      winner: Number(winner)
    };
  }
  /**
   * Check if a player has wagered on a specific battle.
   */
  async hasWagered(battleId, player) {
    return this.publicClient.readContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "hasWagered",
      args: [BigInt(battleId), player]
    });
  }
  /**
   * Get the number of wagers on a specific battle.
   */
  async getWagerCount(battleId) {
    return this.publicClient.readContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "getBattleWagerCount",
      args: [BigInt(battleId)]
    });
  }
  /**
   * Check if the arena contract is paused.
   */
  async isPaused() {
    return this.publicClient.readContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "paused"
    });
  }
  /**
   * Create a new battle. Requires OPERATOR_ROLE.
   */
  async create(params) {
    if (!this.walletClient) throw new WalletRequiredError("arena.create");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("arena.create (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "createBattle",
      args: [
        params.tokenA,
        params.tokenB,
        params.minWager,
        params.maxWager,
        BigInt(params.startTime),
        BigInt(params.endTime)
      ],
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    const txResult = {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
    return { battleId: 0n, txResult };
  }
  /**
   * Place a wager on a battle side. Sends ETH as the wager amount.
   */
  async wager(params) {
    if (!this.walletClient) throw new WalletRequiredError("arena.wager");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("arena.wager (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "placeWager",
      args: [BigInt(params.battleId), params.side],
      value: params.value,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
  /**
   * Claim winnings from a settled battle. Returns the claimed amount.
   */
  async claim(battleId) {
    if (!this.walletClient) throw new WalletRequiredError("arena.claim");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("arena.claim (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: ArenaABI,
      functionName: "claimWinnings",
      args: [BigInt(battleId)],
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: ArenaABI,
          data: log.data,
          topics: log.topics
        });
        if (decoded.eventName === "WinningsClaimed") {
          return decoded.args.amount;
        }
      } catch {
      }
    }
    throw new ContractCallError("Arena", "claimWinnings", "WinningsClaimed event not found in receipt");
  }
};

// src/abis/Events.ts
var EventsABI = [
  {
    name: "eventCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "currentSeason",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }]
  },
  {
    name: "events",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "category", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "prizePool", type: "uint256" },
      { name: "entryFee", type: "uint256" },
      { name: "maxPlayers", type: "uint256" },
      { name: "playerCount", type: "uint256" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "season", type: "uint16" },
      { name: "status", type: "uint8" }
    ]
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "createEvent",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "category", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "entryFee", type: "uint256" },
      { name: "maxPlayers", type: "uint256" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" }
    ],
    outputs: [{ name: "eventId", type: "uint256" }]
  },
  {
    name: "register",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "eventId", type: "uint256" }],
    outputs: []
  },
  {
    name: "claimPrize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "eventId", type: "uint256" }],
    outputs: []
  },
  {
    name: "PlayerRegistered",
    type: "event",
    inputs: [
      { name: "eventId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true }
    ]
  },
  {
    name: "PrizeClaimed",
    type: "event",
    inputs: [
      { name: "eventId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ]
  }
];

// src/modules/events.ts
var EventsModule = class {
  constructor(address, publicClient, walletClient) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  address;
  publicClient;
  walletClient;
  /**
   * Get the total number of events created.
   */
  async getCount() {
    return this.publicClient.readContract({
      address: this.address,
      abi: EventsABI,
      functionName: "eventCount"
    });
  }
  /**
   * Get the current season number.
   */
  async getCurrentSeason() {
    const season = await this.publicClient.readContract({
      address: this.address,
      abi: EventsABI,
      functionName: "currentSeason"
    });
    return Number(season);
  }
  /**
   * Get detailed info for an event by ID.
   */
  async getEvent(eventId) {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: EventsABI,
      functionName: "events",
      args: [BigInt(eventId)]
    });
    const [name, category, metadataURI, prizePool, entryFee, maxPlayers, playerCount, startTime, endTime, season, status] = result;
    return {
      name,
      category,
      metadataURI,
      prizePool,
      entryFee,
      maxPlayers,
      playerCount,
      startTime: Number(startTime),
      endTime: Number(endTime),
      season: Number(season),
      status: Number(status)
    };
  }
  /**
   * Check if a player is registered for an event.
   */
  async isRegistered(eventId, player) {
    return this.publicClient.readContract({
      address: this.address,
      abi: EventsABI,
      functionName: "isRegistered",
      args: [BigInt(eventId), player]
    });
  }
  /**
   * Check if the events contract is paused.
   */
  async isPaused() {
    return this.publicClient.readContract({
      address: this.address,
      abi: EventsABI,
      functionName: "paused"
    });
  }
  /**
   * Register for an event. Sends the entry fee as ETH value.
   */
  async register(eventId, opts) {
    if (!this.walletClient) throw new WalletRequiredError("events.register");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("events.register (no account)");
    let value = opts?.value;
    if (value === void 0) {
      const evt = await this.getEvent(eventId);
      value = evt.entryFee;
    }
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: EventsABI,
      functionName: "register",
      args: [BigInt(eventId)],
      value,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
  /**
   * Claim prize from a completed event.
   */
  async claimPrize(eventId) {
    if (!this.walletClient) throw new WalletRequiredError("events.claimPrize");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("events.claimPrize (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: EventsABI,
      functionName: "claimPrize",
      args: [BigInt(eventId)],
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
};

// src/abis/FeeRouter.ts
var FeeRouterABI = [
  {
    name: "totalDistributed",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "getRecipientCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "recipients",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "wallet", type: "address" },
      { name: "shareBps", type: "uint256" },
      { name: "label", type: "string" }
    ]
  },
  {
    name: "recipientEarnings",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "getTotalShareBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "distribute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: []
  },
  {
    name: "FeeReceived",
    type: "event",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ]
  },
  {
    name: "FeeDistributed",
    type: "event",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "label", type: "string", indexed: false }
    ]
  }
];

// src/modules/fees.ts
var FeeModule = class {
  constructor(address, publicClient, walletClient) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  address;
  publicClient;
  walletClient;
  /**
   * Get the total amount of fees distributed (in wei).
   */
  async getTotalDistributed() {
    return this.publicClient.readContract({
      address: this.address,
      abi: FeeRouterABI,
      functionName: "totalDistributed"
    });
  }
  /**
   * Get the number of fee recipients.
   */
  async getRecipientCount() {
    return this.publicClient.readContract({
      address: this.address,
      abi: FeeRouterABI,
      functionName: "getRecipientCount"
    });
  }
  /**
   * Get the total configured share in basis points.
   */
  async getTotalShareBps() {
    return this.publicClient.readContract({
      address: this.address,
      abi: FeeRouterABI,
      functionName: "getTotalShareBps"
    });
  }
  /**
   * Get the fee recipient at a specific index.
   */
  async getRecipient(index) {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: FeeRouterABI,
      functionName: "recipients",
      args: [index]
    });
    const [wallet, shareBps, label] = result;
    return { wallet, shareBps, label };
  }
  /**
   * Get all current fee recipients and their share configuration.
   */
  async getShares() {
    const count = await this.getRecipientCount();
    const shares = [];
    for (let i = 0n; i < count; i++) {
      shares.push(await this.getRecipient(i));
    }
    return shares;
  }
  /**
   * Get the total pending earnings for a specific recipient address.
   */
  async getEarnings(wallet) {
    return this.publicClient.readContract({
      address: this.address,
      abi: FeeRouterABI,
      functionName: "recipientEarnings",
      args: [wallet]
    });
  }
  /**
   * Distribute accumulated fees to all recipients according to their share.
   */
  async distribute() {
    if (!this.walletClient) throw new WalletRequiredError("fees.distribute");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("fees.distribute (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: FeeRouterABI,
      functionName: "distribute",
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
};

// src/abis/BondingCurve.ts
var BondingCurveABI = [
  {
    "name": "curves",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "creator",
        "type": "address"
      },
      {
        "name": "virtualTokenReserve",
        "type": "uint256"
      },
      {
        "name": "virtualEthReserve",
        "type": "uint256"
      },
      {
        "name": "tokensSold",
        "type": "uint256"
      },
      {
        "name": "ethCollected",
        "type": "uint256"
      },
      {
        "name": "totalSupply",
        "type": "uint256"
      },
      {
        "name": "graduated",
        "type": "bool"
      },
      {
        "name": "pool",
        "type": "address"
      },
      {
        "name": "createdAt",
        "type": "uint64"
      },
      {
        "name": "useExternal",
        "type": "bool"
      },
      {
        "name": "virtualEthSeed",
        "type": "uint256"
      },
      {
        "name": "graduationEth",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getPrice",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getBuyQuote",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "ethAmount",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "tokensOut",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getSellQuote",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "tokenAmount",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "ethOut",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getProgress",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getMarketCap",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getCurveCount",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "graduationThresholdEth",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "startMcapUsd",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "graduationUsd",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "priceUsd",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "maxPriceStale",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "nativeUsdFeed",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ]
  },
  {
    "name": "virtualEthSeed",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "setUsdTargets",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "startMcapUsd_",
        "type": "uint256"
      },
      {
        "name": "graduationUsd_",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "setMaxPriceStale",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "secs",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "setNativeUsdFeed",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "feed",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "name": "setVirtualEthSeed",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "seed",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "paused",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ]
  },
  {
    "name": "buy",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "name": "sell",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "tokenAmount",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "CurveCreated",
    "type": "event",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true
      },
      {
        "name": "totalSupply",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "TokenBought",
    "type": "event",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "ethIn",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "tokensOut",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "newPrice",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "TokenSold",
    "type": "event",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "seller",
        "type": "address",
        "indexed": true
      },
      {
        "name": "tokensIn",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "ethOut",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "newPrice",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "Graduated",
    "type": "event",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "pool",
        "type": "address",
        "indexed": true
      },
      {
        "name": "ethLiquidity",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "tokenLiquidity",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "UsdTargetsUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "startMcapUsd",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "graduationUsd",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "VirtualEthSeedUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "newSeed",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "NativeUsdFeedUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "feed",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "MaxPriceStaleUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "maxPriceStale",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  }
];

// src/modules/trading.ts
var ZERO_ADDRESS3 = "0x0000000000000000000000000000000000000000";
var TradingModule = class {
  constructor(address, publicClient, walletClient) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  address;
  publicClient;
  walletClient;
  /**
   * Get the total number of bonding curves.
   */
  async getCurveCount() {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "getCurveCount"
    });
  }
  /**
   * Get the graduation threshold in ETH (in wei).
   */
  async getGraduationThreshold() {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "graduationThresholdEth"
    });
  }
  /**
   * Get the bonding-curve start market cap target, in USD (1e18-scaled).
   * v2 USD-pegging: the curve anchors its seed to this USD value at the live native/USD price.
   */
  async getStartMcapUsd() {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "startMcapUsd"
    });
  }
  /**
   * Get the graduation market cap target, in USD (1e18-scaled). v2 USD-pegging.
   */
  async getGraduationUsd() {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "graduationUsd"
    });
  }
  /**
   * Get the live native/USD price the curve is using (1e18-scaled USD per native token).
   */
  async getPriceUsd() {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "priceUsd"
    });
  }
  /**
   * Get the full bonding curve state for a token.
   * Returns null if the token has no bonding curve.
   */
  async getCurve(token) {
    const result = await this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "curves",
      args: [token]
    });
    const [tokenAddr, creator, virtualTokenReserve, virtualEthReserve, tokensSold, ethCollected, totalSupply, graduated, pool, createdAt, useExternal, virtualEthSeed, graduationEth] = result;
    if (tokenAddr === ZERO_ADDRESS3) {
      return null;
    }
    return {
      token: tokenAddr,
      creator,
      virtualTokenReserve,
      virtualEthReserve,
      tokensSold,
      ethCollected,
      totalSupply,
      graduated,
      pool,
      createdAt: Number(createdAt),
      useExternal,
      virtualEthSeed,
      graduationEth
    };
  }
  /**
   * Get the current price of a token on its bonding curve (in wei per token).
   */
  async getPrice(token) {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "getPrice",
      args: [token]
    });
  }
  /**
   * Get a buy quote: how many tokens you receive for a given ETH amount.
   */
  async getBuyQuote(token, ethAmount) {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "getBuyQuote",
      args: [token, ethAmount]
    });
  }
  /**
   * Get a sell quote: how much ETH you receive for a given token amount.
   */
  async getSellQuote(token, tokenAmount) {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "getSellQuote",
      args: [token, tokenAmount]
    });
  }
  /**
   * Get the bonding curve progress (0-10000, representing 0-100.00%).
   */
  async getProgress(token) {
    const progress = await this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "getProgress",
      args: [token]
    });
    return Number(progress);
  }
  /**
   * Get the market cap of a token (in wei).
   */
  async getMarketCap(token) {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "getMarketCap",
      args: [token]
    });
  }
  /**
   * Check if the bonding curve contract is paused.
   */
  async isPaused() {
    return this.publicClient.readContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "paused"
    });
  }
  /**
   * Buy tokens on the bonding curve by sending ETH.
   */
  async buy(token, ethAmount) {
    if (!this.walletClient) throw new WalletRequiredError("trading.buy");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("trading.buy (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "buy",
      args: [token],
      value: ethAmount,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
  /**
   * Sell tokens on the bonding curve to receive ETH.
   * NOTE: Caller must approve the BondingCurve contract to spend tokens first.
   */
  async sell(token, tokenAmount) {
    if (!this.walletClient) throw new WalletRequiredError("trading.sell");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("trading.sell (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: BondingCurveABI,
      functionName: "sell",
      args: [token, tokenAmount],
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
};

// src/abis/FeedBoostAuction.ts
var FeedBoostAuctionABI = [
  {
    "name": "getSlot",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "active",
        "type": "bool"
      },
      {
        "name": "minBid",
        "type": "uint256"
      },
      {
        "name": "topToken",
        "type": "address"
      },
      {
        "name": "currentBid",
        "type": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint40"
      }
    ]
  },
  {
    "name": "getSlotCount",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8"
      }
    ]
  },
  {
    "name": "getSlotConfig",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "minBid",
        "type": "uint256"
      },
      {
        "name": "minIncrement",
        "type": "uint256"
      },
      {
        "name": "duration",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getActiveBoosts",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "bidder",
        "type": "address"
      },
      {
        "name": "bid",
        "type": "uint256"
      },
      {
        "name": "startTime",
        "type": "uint40"
      },
      {
        "name": "expiry",
        "type": "uint40"
      }
    ]
  },
  {
    "name": "getBidsForToken",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "slotTypes",
        "type": "uint8[]"
      },
      {
        "name": "bids",
        "type": "uint256[]"
      },
      {
        "name": "expiries",
        "type": "uint40[]"
      }
    ]
  },
  {
    "name": "getMinNextBid",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "getTopBoost",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ]
  },
  {
    "name": "effectiveMinBid",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "effectiveMinIncrement",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "priceUsd",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "priceUsdOrZero",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "slotActive",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ]
  },
  {
    "name": "slotName",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string"
      }
    ]
  },
  {
    "name": "boosts",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "bidder",
        "type": "address"
      },
      {
        "name": "bid",
        "type": "uint256"
      },
      {
        "name": "startTime",
        "type": "uint40"
      },
      {
        "name": "expiry",
        "type": "uint40"
      }
    ]
  },
  {
    "name": "totalCollected",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "pendingRefunds",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "feeRouter",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ]
  },
  {
    "name": "protocolFeeBps",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16"
      }
    ]
  },
  {
    "name": "nativeUsdFeed",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ]
  },
  {
    "name": "maxPriceStale",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ]
  },
  {
    "name": "paused",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ]
  },
  {
    "name": "placeBid",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": []
  },
  {
    "name": "placeBidBatch",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "slots",
        "type": "uint8[]"
      },
      {
        "name": "amounts",
        "type": "uint256[]"
      }
    ],
    "outputs": []
  },
  {
    "name": "extendBoost",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "slotType",
        "type": "uint8"
      }
    ],
    "outputs": []
  },
  {
    "name": "withdrawRefund",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [],
    "outputs": []
  },
  {
    "name": "setSlotConfig",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      },
      {
        "name": "minBid",
        "type": "uint256"
      },
      {
        "name": "minIncrement",
        "type": "uint256"
      },
      {
        "name": "duration",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "setSlotUsd",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      },
      {
        "name": "minBidUsd",
        "type": "uint256"
      },
      {
        "name": "minIncrementUsd",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "addSlot",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "name",
        "type": "string"
      },
      {
        "name": "minBid",
        "type": "uint256"
      },
      {
        "name": "minIncrement",
        "type": "uint256"
      },
      {
        "name": "duration",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint8"
      }
    ]
  },
  {
    "name": "setSlotActive",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      },
      {
        "name": "active",
        "type": "bool"
      }
    ],
    "outputs": []
  },
  {
    "name": "setSlotName",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8"
      },
      {
        "name": "name",
        "type": "string"
      }
    ],
    "outputs": []
  },
  {
    "name": "setFeeRouter",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "router",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "name": "setProtocolFeeBps",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "feeBps",
        "type": "uint16"
      }
    ],
    "outputs": []
  },
  {
    "name": "setNativeUsdFeed",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "feed",
        "type": "address"
      }
    ],
    "outputs": []
  },
  {
    "name": "setMaxPriceStale",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "secs",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "setKeeperPrice",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "priceUsd_",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "name": "BidPlaced",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "bidder",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "expiry",
        "type": "uint40",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "BidRefunded",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "prevBidder",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "BoostWon",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "bidder",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "startTime",
        "type": "uint40",
        "indexed": false
      },
      {
        "name": "expiry",
        "type": "uint40",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "BoostExtended",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "bidder",
        "type": "address",
        "indexed": true
      },
      {
        "name": "addedAmount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "newExpiry",
        "type": "uint40",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "BoostExpired",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "name": "SlotAdded",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "name",
        "type": "string",
        "indexed": false
      },
      {
        "name": "minBid",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "minIncrement",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "duration",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "SlotConfigUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "minBid",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "minIncrement",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "duration",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "SlotConfigUsdUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "minBidUsd",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "minIncrementUsd",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "SlotActiveUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "active",
        "type": "bool",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "FeeRouterUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "feeRouter",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "ProtocolFeeBpsUpdated",
    "type": "event",
    "inputs": [
      {
        "name": "protocolFeeBps",
        "type": "uint16",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "ProtocolFeeRouted",
    "type": "event",
    "inputs": [
      {
        "name": "slotType",
        "type": "uint8",
        "indexed": true
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "RefundWithdrawn",
    "type": "event",
    "inputs": [
      {
        "name": "bidder",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "name": "FeesWithdrawn",
    "type": "event",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  }
];

// src/modules/feedboost.ts
var FeedBoostModule = class {
  constructor(address, publicClient, walletClient) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  address;
  publicClient;
  walletClient;
  /** Get the number of configured auction slots. */
  async getSlotCount() {
    const n = await this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "getSlotCount"
    });
    return Number(n);
  }
  /** Get a slot's live state (name, active, current top token + bid, expiry). */
  async getSlot(slotType) {
    const [name, active, minBid, topToken, currentBid, expiry] = await this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "getSlot",
      args: [slotType]
    });
    return {
      slotType,
      name,
      active,
      minBid,
      topToken,
      currentBid,
      expiry: Number(expiry)
    };
  }
  /** List every slot's live state. */
  async listSlots() {
    const count = await this.getSlotCount();
    const slots = [];
    for (let i = 0; i < count; i++) {
      slots.push(await this.getSlot(i));
    }
    return slots;
  }
  /** Get a slot's static config (minBid, minIncrement, duration). */
  async getSlotConfig(slotType) {
    const [minBid, minIncrement, duration] = await this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "getSlotConfig",
      args: [slotType]
    });
    return { minBid, minIncrement, duration };
  }
  /** Get the live boost currently occupying a slot. */
  async getActiveBoost(slotType) {
    const [token, bidder, bid, startTime, expiry] = await this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "getActiveBoosts",
      args: [slotType]
    });
    return { token, bidder, bid, startTime: Number(startTime), expiry: Number(expiry) };
  }
  /**
   * Get the effective minimum bid for a slot, in native currency (wei), derived
   * from the USD target at the live native/USD price. v2 — the amount to beat
   * when the slot is empty.
   */
  async getEffectiveMinBid(slotType) {
    return this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "effectiveMinBid",
      args: [slotType]
    });
  }
  /** Get the minimum next bid required to take a slot (accounts for the current bid + increment). */
  async getMinNextBid(slotType) {
    return this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "getMinNextBid",
      args: [slotType]
    });
  }
  /** The FeeRouter that the auction routes its protocol fee to. */
  async getFeeRouter() {
    return this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "feeRouter"
    });
  }
  /** The protocol fee in basis points taken from each winning bid. */
  async getProtocolFeeBps() {
    const bps = await this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "protocolFeeBps"
    });
    return Number(bps);
  }
  /** Check if the auction is paused. */
  async isPaused() {
    return this.publicClient.readContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "paused"
    });
  }
  /**
   * Place a bid on a single feed-boost slot for a token.
   * `params.value` is the bid amount in wei (sent as msg.value).
   */
  async placeBid(params) {
    if (!this.walletClient) throw new WalletRequiredError("feedBoost.placeBid");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("feedBoost.placeBid (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "placeBid",
      args: [params.token, params.slotType],
      value: params.value,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
  /**
   * Place à la carte bids across multiple slots in a single transaction.
   * `amounts` are per-slot bid amounts; the tx value defaults to their sum.
   */
  async placeBidBatch(params) {
    if (!this.walletClient) throw new WalletRequiredError("feedBoost.placeBidBatch");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("feedBoost.placeBidBatch (no account)");
    const value = params.value ?? params.amounts.reduce((a, b) => a + b, 0n);
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "placeBidBatch",
      args: [params.token, params.slots, params.amounts],
      value,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
  /** Withdraw any pending refund owed to the caller (outbid funds). */
  async withdrawRefund() {
    if (!this.walletClient) throw new WalletRequiredError("feedBoost.withdrawRefund");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("feedBoost.withdrawRefund (no account)");
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: FeedBoostAuctionABI,
      functionName: "withdrawRefund",
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    };
  }
};

// src/abis/HookOSV3Launcher.ts
var HookOSV3LauncherABI = [
  {
    "name": "effectiveLaunchFee",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "name": "hookSwapLockFee",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "name": "quoteLaunchCost",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      { "name": "lockOnHookSwap", "type": "bool" },
      { "name": "initialBuyEth", "type": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "name": "launchCount",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "name": "launchFeeUsd",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "name": "paused",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "bool" }]
  },
  {
    "name": "pairAddressOf",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "pair", "type": "uint8" }],
    "outputs": [{ "name": "", "type": "address" }]
  },
  {
    "name": "hookPairStatus",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      { "name": "ok", "type": "bool" },
      { "name": "depth", "type": "uint256" },
      { "name": "fresh", "type": "bool" }
    ]
  },
  {
    "name": "initCodeHash",
    "type": "function",
    "stateMutability": "pure",
    "inputs": [
      { "name": "name_", "type": "string" },
      { "name": "symbol_", "type": "string" },
      { "name": "supply_", "type": "uint256" },
      { "name": "creator_", "type": "address" },
      { "name": "metadataURI_", "type": "string" }
    ],
    "outputs": [{ "name": "", "type": "bytes32" }]
  },
  {
    "name": "predictToken",
    "type": "function",
    "stateMutability": "view",
    "inputs": [
      { "name": "salt", "type": "bytes32" },
      { "name": "name_", "type": "string" },
      { "name": "symbol_", "type": "string" },
      { "name": "supply_", "type": "uint256" },
      { "name": "creator_", "type": "address" },
      { "name": "metadataURI_", "type": "string" }
    ],
    "outputs": [{ "name": "", "type": "address" }]
  },
  {
    "name": "getLaunch",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "id", "type": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "components": [
          { "name": "token", "type": "address" },
          { "name": "pool", "type": "address" },
          { "name": "creator", "type": "address" },
          { "name": "tokenId", "type": "uint256" },
          { "name": "feeTier", "type": "uint24" },
          { "name": "dex", "type": "uint8" },
          { "name": "locker", "type": "address" },
          { "name": "pair", "type": "uint8" },
          { "name": "pairToken", "type": "address" },
          { "name": "metadataURI", "type": "string" },
          { "name": "createdAt", "type": "uint256" }
        ]
      }
    ]
  },
  {
    "name": "getLaunchByToken",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "token", "type": "address" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "components": [
          { "name": "token", "type": "address" },
          { "name": "pool", "type": "address" },
          { "name": "creator", "type": "address" },
          { "name": "tokenId", "type": "uint256" },
          { "name": "feeTier", "type": "uint24" },
          { "name": "dex", "type": "uint8" },
          { "name": "locker", "type": "address" },
          { "name": "pair", "type": "uint8" },
          { "name": "pairToken", "type": "address" },
          { "name": "metadataURI", "type": "string" },
          { "name": "createdAt", "type": "uint256" }
        ]
      }
    ]
  },
  {
    "name": "isHookOSV3Token",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "", "type": "address" }],
    "outputs": [{ "name": "", "type": "bool" }]
  },
  {
    "name": "launch",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "components": [
          { "name": "name", "type": "string" },
          { "name": "symbol", "type": "string" },
          { "name": "metadataURI", "type": "string" },
          { "name": "totalSupply", "type": "uint256" },
          { "name": "salt", "type": "bytes32" },
          { "name": "sqrtPriceX96", "type": "uint160" },
          { "name": "tickLower", "type": "int24" },
          { "name": "tickUpper", "type": "int24" },
          { "name": "initialBuyEth", "type": "uint256" },
          { "name": "initialBuyMinOut", "type": "uint256" },
          { "name": "initialBuyDeadline", "type": "uint256" },
          { "name": "dex", "type": "uint8" },
          { "name": "pair", "type": "uint8" },
          { "name": "lockOnHookSwap", "type": "bool" }
        ]
      }
    ],
    "outputs": [
      { "name": "token", "type": "address" },
      { "name": "pool", "type": "address" },
      { "name": "tokenId", "type": "uint256" }
    ]
  },
  {
    "name": "TokenCreated",
    "type": "event",
    "inputs": [
      { "name": "token", "type": "address", "indexed": true },
      { "name": "creator", "type": "address", "indexed": true },
      { "name": "name", "type": "string", "indexed": false },
      { "name": "symbol", "type": "string", "indexed": false },
      { "name": "initialSupply", "type": "uint256", "indexed": false }
    ],
    "anonymous": false
  },
  {
    "name": "LaunchCreated",
    "type": "event",
    "inputs": [
      { "name": "token", "type": "address", "indexed": true },
      { "name": "creator", "type": "address", "indexed": true },
      { "name": "name", "type": "string", "indexed": false },
      { "name": "symbol", "type": "string", "indexed": false },
      { "name": "initialSupply", "type": "uint256", "indexed": false }
    ],
    "anonymous": false
  },
  {
    "name": "PoolSeeded",
    "type": "event",
    "inputs": [
      { "name": "token", "type": "address", "indexed": true },
      { "name": "pool", "type": "address", "indexed": true },
      { "name": "tokenId", "type": "uint256", "indexed": false },
      { "name": "feeTier", "type": "uint24", "indexed": false },
      { "name": "dex", "type": "uint8", "indexed": false },
      { "name": "locker", "type": "address", "indexed": false },
      { "name": "pair", "type": "uint8", "indexed": false },
      { "name": "pairToken", "type": "address", "indexed": false }
    ],
    "anonymous": false
  },
  {
    "name": "DevBuyExecuted",
    "type": "event",
    "inputs": [
      { "name": "token", "type": "address", "indexed": true },
      { "name": "buyer", "type": "address", "indexed": true },
      { "name": "ethIn", "type": "uint256", "indexed": false },
      { "name": "minOut", "type": "uint256", "indexed": false }
    ],
    "anonymous": false
  },
  {
    "name": "LaunchFeeCollected",
    "type": "event",
    "inputs": [
      { "name": "payer", "type": "address", "indexed": true },
      { "name": "amount", "type": "uint256", "indexed": false }
    ],
    "anonymous": false
  }
];

// src/abis/HookOSV3FeeVault.ts
var HookOSV3FeeVaultABI = [
  {
    "name": "creatorShareBpsByDex",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "dex", "type": "uint8" }],
    "outputs": [{ "name": "", "type": "uint16" }]
  },
  {
    "name": "buybackShareBps",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint16" }]
  }
];

// src/abis/HookOSV3Buyback.ts
var HookOSV3BuybackABI = [
  {
    "name": "totalBurned",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "name": "totalWethSpent",
    "type": "function",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "name": "BoughtBack",
    "type": "event",
    "inputs": [
      { "name": "caller", "type": "address", "indexed": true },
      { "name": "amountIn", "type": "uint256", "indexed": false },
      { "name": "burned", "type": "uint256", "indexed": false },
      { "name": "totalBurned", "type": "uint256", "indexed": false }
    ],
    "anonymous": false
  }
];

// src/types.ts
var HookPoint = /* @__PURE__ */ ((HookPoint2) => {
  HookPoint2[HookPoint2["BeforeSwap"] = 0] = "BeforeSwap";
  HookPoint2[HookPoint2["AfterSwap"] = 1] = "AfterSwap";
  HookPoint2[HookPoint2["BeforeAddLiquidity"] = 2] = "BeforeAddLiquidity";
  HookPoint2[HookPoint2["AfterAddLiquidity"] = 3] = "AfterAddLiquidity";
  HookPoint2[HookPoint2["BeforeRemoveLiquidity"] = 4] = "BeforeRemoveLiquidity";
  HookPoint2[HookPoint2["AfterRemoveLiquidity"] = 5] = "AfterRemoveLiquidity";
  return HookPoint2;
})(HookPoint || {});
var BattleStatus = /* @__PURE__ */ ((BattleStatus2) => {
  BattleStatus2[BattleStatus2["Open"] = 0] = "Open";
  BattleStatus2[BattleStatus2["Active"] = 1] = "Active";
  BattleStatus2[BattleStatus2["Settled"] = 2] = "Settled";
  BattleStatus2[BattleStatus2["Cancelled"] = 3] = "Cancelled";
  return BattleStatus2;
})(BattleStatus || {});
var Side = /* @__PURE__ */ ((Side2) => {
  Side2[Side2["TeamA"] = 0] = "TeamA";
  Side2[Side2["TeamB"] = 1] = "TeamB";
  return Side2;
})(Side || {});
var EventStatus = /* @__PURE__ */ ((EventStatus2) => {
  EventStatus2[EventStatus2["Upcoming"] = 0] = "Upcoming";
  EventStatus2[EventStatus2["Live"] = 1] = "Live";
  EventStatus2[EventStatus2["Ended"] = 2] = "Ended";
  EventStatus2[EventStatus2["Cancelled"] = 3] = "Cancelled";
  return EventStatus2;
})(EventStatus || {});
var V3Dex = /* @__PURE__ */ ((V3Dex2) => {
  V3Dex2[V3Dex2["UniswapV3"] = 0] = "UniswapV3";
  V3Dex2[V3Dex2["HookSwap"] = 1] = "HookSwap";
  return V3Dex2;
})(V3Dex || {});
var V3PairToken = /* @__PURE__ */ ((V3PairToken2) => {
  V3PairToken2[V3PairToken2["WETH"] = 0] = "WETH";
  V3PairToken2[V3PairToken2["HOOK"] = 1] = "HOOK";
  return V3PairToken2;
})(V3PairToken || {});
var RewardMode = /* @__PURE__ */ ((RewardMode2) => {
  RewardMode2["Single"] = "single";
  RewardMode2["Basket"] = "basket";
  RewardMode2["Index"] = "index";
  return RewardMode2;
})(RewardMode || {});

// src/modules/v3launch.ts
var ZERO_ADDRESS4 = "0x0000000000000000000000000000000000000000";
function create2Address(deployer, salt, initCodeHash) {
  const hash = keccak256(concat(["0xff", deployer, salt, initCodeHash]));
  return getAddress(slice(hash, 12));
}
var V3LaunchModule = class {
  constructor(addresses, publicClient, walletClient) {
    this.addresses = addresses;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  addresses;
  publicClient;
  walletClient;
  /** The HookOSV3Launcher address this module targets. */
  get launcherAddress() {
    return this.addresses.launcher;
  }
  // ── Reads: launcher ──────────────────────────────────────────────────────
  /**
   * Live native-denominated launch fee (wei), derived from the $8 USD peg at the BondingCurve
   * keeper price. Fails OPEN — returns 0 if the peg is unset or the price is stale.
   */
  async getEffectiveLaunchFee() {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "effectiveLaunchFee"
    });
  }
  /** The configured USD launch fee target (1e18-scaled). 0 disables the fee. */
  async getLaunchFeeUsd() {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "launchFeeUsd"
    });
  }
  /** Flat one-time native fee HookSwap's Position Locker charges (0 if the upsell is disabled). */
  async getHookSwapLockFee() {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "hookSwapLockFee"
    });
  }
  /** Total native (wei) a launch requires: launch fee + optional locker fee + dev buy. */
  async quoteLaunchCost(lockOnHookSwap, initialBuyEth) {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "quoteLaunchCost",
      args: [lockOnHookSwap, initialBuyEth]
    });
  }
  /** Total number of HookOS V3 launches to date. */
  async getLaunchCount() {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "launchCount"
    });
  }
  /** Whether the launcher is paused. */
  async isPaused() {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "paused"
    });
  }
  /** Whether `token` was launched via HookOS V3. */
  async isHookOSV3Token(token) {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "isHookOSV3Token",
      args: [token]
    });
  }
  /** The address a {@link V3PairToken} resolves to (WETH by default). */
  async getPairAddress(pair = 0 /* WETH */) {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "pairAddressOf",
      args: [pair]
    });
  }
  /** Fetch a launch record by index. */
  async getLaunch(id) {
    const l = await this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "getLaunch",
      args: [id]
    });
    return this.toLaunchInfo(l);
  }
  /** Fetch a launch record by token address. */
  async getLaunchByToken(token) {
    const l = await this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "getLaunchByToken",
      args: [token]
    });
    return this.toLaunchInfo(l);
  }
  toLaunchInfo(l) {
    return {
      token: l.token,
      pool: l.pool,
      creator: l.creator,
      tokenId: l.tokenId,
      feeTier: Number(l.feeTier),
      dex: l.dex,
      locker: l.locker,
      pair: l.pair,
      pairToken: l.pairToken,
      metadataURI: l.metadataURI,
      createdAt: Number(l.createdAt)
    };
  }
  // ── Reads: fee vault ─────────────────────────────────────────────────────
  /** Creator share of collected LP fees, in bps, for a DEX (UniswapV3 = 5000, HookSwap = 7000). */
  async getCreatorShareBps(dex) {
    const bps = await this.publicClient.readContract({
      address: this.addresses.feeVault,
      abi: HookOSV3FeeVaultABI,
      functionName: "creatorShareBpsByDex",
      args: [dex]
    });
    return Number(bps);
  }
  /** Share of the PROTOCOL native side of collected LP fees routed to the buyback, in bps. */
  async getBuybackShareBps() {
    const bps = await this.publicClient.readContract({
      address: this.addresses.feeVault,
      abi: HookOSV3FeeVaultABI,
      functionName: "buybackShareBps"
    });
    return Number(bps);
  }
  // ── Reads: buyback flywheel ──────────────────────────────────────────────
  /** Total $HOOK bought back and burned (to 0xdEaD) so far, in wei. */
  async getTotalBurned() {
    return this.publicClient.readContract({
      address: this.addresses.buyback,
      abi: HookOSV3BuybackABI,
      functionName: "totalBurned"
    });
  }
  /** Total WETH ever committed to buybacks (gross, tax included), in wei. */
  async getTotalWethSpent() {
    return this.publicClient.readContract({
      address: this.addresses.buyback,
      abi: HookOSV3BuybackABI,
      functionName: "totalWethSpent"
    });
  }
  // ── CREATE2 salt mining ──────────────────────────────────────────────────
  /** The launcher's CREATE2 init-code hash for a given token (mine salts against this). */
  async getInitCodeHash(name, symbol, supply, creator, metadataURI) {
    return this.publicClient.readContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "initCodeHash",
      args: [name, symbol, supply, creator, metadataURI]
    });
  }
  /**
   * Mine a CREATE2 salt whose predicted token address sorts BELOW the pair (token == token0) —
   * the invariant `launch()` enforces (`NotToken0()` otherwise). Mirrors the reference
   * `mineToken0Salt` in contracts/test/helpers/hookos-v3.ts: computed locally from the
   * launcher's init-code hash, no RPC round-trip per candidate.
   */
  async mineSalt(p, opts = {}) {
    const wantToken0 = opts.wantToken0 ?? true;
    const limit = opts.limit ?? 5e5;
    const initHash = await this.getInitCodeHash(p.name, p.symbol, p.supply, p.creator, p.metadataURI);
    const pairAddr = await this.getPairAddress(opts.pair ?? 0 /* WETH */);
    const pairLc = pairAddr.toLowerCase();
    for (let i = 1; i < limit; i++) {
      const salt = pad(toHex(i), { size: 32 });
      const token = create2Address(this.addresses.launcher, salt, initHash);
      const isToken0 = token.toLowerCase() < pairLc;
      if (isToken0 === wantToken0) return { salt, token };
    }
    throw new ValidationError("salt", "exhausted salt space while mining token0-ness");
  }
  /**
   * Build a ready-to-send `launch()` tuple, mining the CREATE2 salt so the token sorts as token0.
   * The default `sqrtPriceX96` is advisory-only (the launcher ignores it and derives price from
   * `tickLower`). `creator` MUST match the wallet that will send the launch.
   */
  async buildLaunchParams(o) {
    const initialBuyEth = o.initialBuyEth ?? 0n;
    const initialBuyMinOut = o.initialBuyMinOut ?? 0n;
    if (initialBuyEth > 0n && initialBuyMinOut === 0n) {
      throw new ValidationError("initialBuyMinOut", "must be > 0 whenever initialBuyEth > 0 (no 0-slippage)");
    }
    const metadataURI = o.metadataURI ?? "";
    const pair = o.pair ?? 0 /* WETH */;
    const { salt, token } = await this.mineSalt(
      { name: o.name, symbol: o.symbol, supply: o.totalSupply, creator: o.creator, metadataURI },
      { pair, limit: o.saltLimit }
    );
    const params = {
      name: o.name,
      symbol: o.symbol,
      metadataURI,
      totalSupply: o.totalSupply,
      salt,
      sqrtPriceX96: o.sqrtPriceX96 ?? 1n << 96n,
      tickLower: o.tickLower,
      tickUpper: o.tickUpper,
      initialBuyEth,
      initialBuyMinOut,
      initialBuyDeadline: o.initialBuyDeadline ?? 0n,
      dex: o.dex ?? 0 /* UniswapV3 */,
      pair,
      lockOnHookSwap: o.lockOnHookSwap ?? false
    };
    return { params, predictedToken: token, salt };
  }
  // ── Launch (write) ───────────────────────────────────────────────────────
  /**
   * Deploy a token and single-sided-seed 100% of its supply into a fresh v3 pool.
   * `value` defaults to `quoteLaunchCost(lockOnHookSwap, initialBuyEth)` (launch fee + optional
   * locker fee + dev buy). Requires a wallet client.
   */
  async launch(params, value) {
    if (!this.walletClient) throw new WalletRequiredError("v3.launch");
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError("v3.launch (no account)");
    const cost = value ?? await this.quoteLaunchCost(params.lockOnHookSwap, params.initialBuyEth);
    const hash = await this.walletClient.writeContract({
      address: this.addresses.launcher,
      abi: HookOSV3LauncherABI,
      functionName: "launch",
      args: [params],
      value: cost,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    let token = ZERO_ADDRESS4;
    let pool = ZERO_ADDRESS4;
    let tokenId = 0n;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: HookOSV3LauncherABI,
          data: log.data,
          topics: log.topics
        });
        if (decoded.eventName === "PoolSeeded") {
          const a = decoded.args;
          token = a.token;
          pool = a.pool;
          tokenId = a.tokenId;
          break;
        }
      } catch {
      }
    }
    if (token === ZERO_ADDRESS4) {
      throw new ContractCallError("HookOSV3Launcher", "launch", "PoolSeeded event not found in receipt");
    }
    return {
      token,
      pool,
      tokenId,
      txResult: {
        hash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed
      }
    };
  }
};

// src/abis/StockRewardLauncherV4.ts
var StockRewardLauncherV4ABI = [
  {
    name: "launch",
    type: "function",
    stateMutability: "payable",
    // payable for the OPTIONAL atomic dev buy (msg.value === initialBuyEth)
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "supply", type: "uint256" },
          // full 18-dec supply; (supply − creatorAmount) is seeded
          { name: "creatorAmount", type: "uint256" },
          // 0 for a pure fair launch
          { name: "sqrtPriceX96", type: "uint160" },
          // single-sided seed price (computed off-chain for the sort)
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "fee", type: "uint24" },
          // v4 pool fee tier
          { name: "tickSpacing", type: "int24" },
          // v4 pool tick spacing
          { name: "admin", type: "address" },
          // final DEFAULT_ADMIN of the token (rescue authority)
          { name: "creator", type: "address" },
          // pool creator (hook tax authority) + creatorAmount recipient
          { name: "buyBps", type: "uint16" },
          { name: "sellBps", type: "uint16" },
          { name: "guardWindowSecs", type: "uint256" },
          // sniper-guard window (0 = none; ≤ 1h on-chain)
          { name: "initialBuyEth", type: "uint256" },
          // optional dev buy, funded from msg.value (0 = none)
          { name: "initialBuyMinOut", type: "uint256" },
          // REQUIRED > 0 when initialBuyEth > 0 (never 0-slippage)
          { name: "initialBuyLimitSqrtPriceX96", type: "uint160" }
          // coarse swap price limit for the dev buy
        ]
      }
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "poolId", type: "bytes32" },
      { name: "positionId", type: "uint256" }
    ]
  },
  {
    // Enumerate launches by index (0..launchCount-1) — the same walk the keeper uses to
    // auto-discover launched stock-reward tokens (RH public RPC times out on eth_getLogs).
    name: "getLaunch",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "poolId", type: "bytes32" },
          { name: "creator", type: "address" },
          { name: "positionId", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "seededToPool", type: "uint256" },
          { name: "toCreator", type: "uint256" },
          { name: "createdAt", type: "uint256" }
        ]
      }
    ]
  },
  {
    // On-chain identity fallback for the token page — a stock-reward token is minted by this
    // launcher (NOT TokenFactory), so getLaunchByToken resolves identity straight from chain.
    name: "getLaunchByToken",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "poolId", type: "bytes32" },
          { name: "creator", type: "address" },
          { name: "positionId", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "seededToPool", type: "uint256" },
          { name: "toCreator", type: "uint256" },
          { name: "createdAt", type: "uint256" }
        ]
      }
    ]
  },
  // Canonical launch event — `poolId` is the v4 poolId (a v4 pool is not an address).
  {
    name: "Launched",
    type: "event",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "seededToPool", type: "uint256", indexed: false },
      { name: "toCreator", type: "uint256", indexed: false }
    ]
  },
  {
    name: "DevBuyExecuted",
    type: "event",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "ethIn", type: "uint256", indexed: false },
      { name: "tokenOut", type: "uint256", indexed: false }
    ]
  },
  // Read views present on V4.
  { name: "weth", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "stockTaxHook", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "launchCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "isStockRewardToken", type: "function", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "", type: "bool" }] }
];

// src/abis/StockRewardLauncherV2.ts
var StockRewardLauncherV2ABI = [
  {
    name: "launch",
    type: "function",
    stateMutability: "payable",
    // payable for the OPTIONAL atomic dev buy (msg.value = initialBuyEth [+ excess])
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "supply", type: "uint256" },
          // full 18-dec supply; (supply − creatorAmount) is seeded
          { name: "creatorAmount", type: "uint256" },
          // 0 for a pure fair launch
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "admin", type: "address" },
          // final DEFAULT_ADMIN of the token
          { name: "creator", type: "address" },
          // final tax authority + creatorAmount recipient
          { name: "vault", type: "address" },
          // StockRewardVault — the tax skim sink
          { name: "buyBps", type: "uint16" },
          { name: "sellBps", type: "uint16" },
          { name: "dex", type: "uint8" },
          // 0 = UniswapV3, 1 = HookSwap
          { name: "initialBuyEth", type: "uint256" },
          // optional dev buy, funded from msg.value (0 = none)
          { name: "initialBuyMinOut", type: "uint256" },
          // REQUIRED > 0 when initialBuyEth > 0 (never 0-slippage)
          { name: "initialBuyDeadline", type: "uint256" }
          // 0 => block.timestamp
        ]
      }
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "pool", type: "address" },
      { name: "tokenId", type: "uint256" }
    ]
  },
  {
    name: "swapRouterOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "dex", type: "uint8" }],
    outputs: [{ name: "", type: "address" }]
  },
  {
    name: "getLaunchByToken",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "pool", type: "address" },
          { name: "creator", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "feeTier", type: "uint24" },
          { name: "dex", type: "uint8" },
          { name: "seededToPool", type: "uint256" },
          { name: "toCreator", type: "uint256" },
          { name: "createdAt", type: "uint256" }
        ]
      }
    ]
  },
  {
    name: "DevBuyExecuted",
    type: "event",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "ethIn", type: "uint256", indexed: false },
      { name: "minOut", type: "uint256", indexed: false }
    ]
  },
  {
    name: "Launched",
    type: "event",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "pool", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "seededToPool", type: "uint256", indexed: false },
      { name: "toCreator", type: "uint256", indexed: false }
    ]
  },
  {
    name: "dexConfig",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "dex", type: "uint8" }],
    outputs: [
      { name: "factory", type: "address" },
      { name: "positionManager", type: "address" },
      { name: "feeTier", type: "uint24" },
      { name: "tickSpacing", type: "int24" }
    ]
  },
  { name: "weth", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "launchCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "isStockRewardToken", type: "function", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "", type: "bool" }] }
];
var StockKeeperABI = [
  { name: "keeperPriceUsd", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "keeperPriceUpdatedAt", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "maxPriceStale", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }
];

// src/abis/StockRewardVault.ts
var StockRewardVaultABI = [
  // The creator's chosen reward basket (weights in bps, MUST sum to 10000).
  {
    name: "getBasket",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "rewardToken", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "stock", type: "address" },
          { name: "weightBps", type: "uint16" }
        ]
      }
    ]
  },
  // The on-chain reward allowlist — only allowlisted stocks can be bought for holders.
  {
    name: "stockAllowed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "stock", type: "address" }],
    outputs: [{ name: "", type: "bool" }]
  },
  // The Chainlink-shaped USD feed bound to a stock (8dp).
  {
    name: "priceFeed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "stock", type: "address" }],
    outputs: [{ name: "", type: "address" }]
  },
  // Holder-pool telemetry.
  {
    name: "holderUsdgPool",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "rewardToken", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "totalHolderUsdg",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "totalStockBought",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "stock", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  // The oracle-floored USDG amount a given asset (e.g. WETH) is worth — the min-out floor the
  // vault prices its Uniswap-V3 conversions against. Fails CLOSED (0) on a stale/bad feed.
  {
    name: "usdgFloorForAsset",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amountIn", type: "uint256" }
    ],
    outputs: [{ name: "floor", type: "uint256" }]
  }
];
var WethUsdAggregatorABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" }
    ]
  },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { name: "description", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] }
];

// src/abis/MerkleStockDistributor.ts
var MerkleStockDistributorABI = [
  // ── Reads ──
  { name: "epochCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    name: "epochs",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "epoch", type: "uint256" }],
    outputs: [
      { name: "stock", type: "address" },
      { name: "root", type: "bytes32" },
      { name: "totalAmount", type: "uint256" },
      { name: "claimedAmount", type: "uint256" },
      { name: "createdAt", type: "uint40" },
      { name: "claimDeadline", type: "uint40" },
      { name: "closed", type: "bool" }
    ]
  },
  {
    name: "hasClaimed",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "epoch", type: "uint256" },
      { name: "account", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "unclaimed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "epoch", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  // ── Writes (Merkle-proof gated; proof comes from the keeper/indexer) ──
  {
    name: "claim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epoch", type: "uint256" },
      { name: "stock", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "proof", type: "bytes32[]" }
    ],
    outputs: []
  },
  {
    name: "claimFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epoch", type: "uint256" },
      { name: "account", type: "address" },
      { name: "stock", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "proof", type: "bytes32[]" }
    ],
    outputs: []
  },
  {
    name: "claimForMany",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "epochIds", type: "uint256[]" },
      { name: "accounts", type: "address[]" },
      { name: "stocks", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "proofs", type: "bytes32[][]" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  }
];
var V3_TICK_SPACING = {
  100: 1,
  500: 10,
  3e3: 60,
  1e4: 200
};
var V3_FEE_TIERS = [500, 3e3, 1e4];
var V3_DEFAULT_FEE_TIER = 1e4;
function tickSpacingForFee(feeTier) {
  const spacing = V3_TICK_SPACING[feeTier];
  if (!spacing) throw new ValidationError("feeTier", `Unsupported v3 fee tier: ${feeTier}`);
  return spacing;
}
var RH_TICK_SPACING = 60;
var MIN_SQRT_RATIO = 4295128739n + 1n;
var MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n - 1n;
var V3_MIN_SQRT_RATIO = MIN_SQRT_RATIO;
var V3_MAX_SQRT_RATIO = MAX_SQRT_RATIO;
function isqrt(n) {
  if (n < 0n) throw new Error("negative");
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
function tickForPriceMultiplier(mult, spacing) {
  const raw = Math.log(mult) / Math.log(1.0001);
  const aligned = Math.round(raw / spacing) * spacing;
  return aligned === 0 ? spacing : aligned;
}
function computeV3FairLaunchParams(opts) {
  const {
    targetMcapUsd,
    supplyTokens,
    nativeUsdPrice,
    tokenIsZero,
    feeTier = V3_DEFAULT_FEE_TIER,
    bandWidthMultiplier = 25
  } = opts;
  if (bandWidthMultiplier <= 1) throw new ValidationError("bandWidthMultiplier", "must be > 1");
  if (supplyTokens <= 0n) throw new ValidationError("supplyTokens", "must be > 0");
  if (targetMcapUsd <= 0n) throw new ValidationError("targetMcapUsd", "must be > 0");
  if (nativeUsdPrice <= 0n) throw new ValidationError("nativeUsdPrice", "must be > 0 (stale or unset keeper price)");
  const spacing = tickSpacingForFee(feeTier);
  const pricePerTokenUsd1e18 = targetMcapUsd * 10n ** 18n / supplyTokens;
  if (pricePerTokenUsd1e18 <= 0n) throw new ValidationError("targetMcapUsd", "target MCap too low for this supply");
  const num = tokenIsZero ? pricePerTokenUsd1e18 : nativeUsdPrice;
  const den = tokenIsZero ? nativeUsdPrice : pricePerTokenUsd1e18;
  const seedSqrtPriceX96 = isqrt(num * 2n ** 192n / den);
  const seedSqrtP = Number(seedSqrtPriceX96) / Number(2n ** 96n);
  const priceRatioRaw = seedSqrtP * seedSqrtP;
  const seedTick = Math.round(Math.log(priceRatioRaw) / Math.log(1.0001) / spacing) * spacing;
  const offset = tickForPriceMultiplier(bandWidthMultiplier, spacing);
  const tickLower = tokenIsZero ? seedTick : seedTick - offset;
  const tickUpper = tokenIsZero ? seedTick + offset : seedTick;
  const boundaryTick = tokenIsZero ? tickLower : tickUpper;
  const rawSqrt = Math.pow(1.0001, boundaryTick / 2) * Math.pow(2, 96);
  const sqrtPriceX96 = tokenIsZero ? BigInt(Math.floor(rawSqrt)) - 2n : BigInt(Math.ceil(rawSqrt)) + 2n;
  const nativeUsdFloat = Number(nativeUsdPrice) / 1e18;
  const supplyFloat = Number(supplyTokens);
  const seedRatio = Math.pow(1.0001, seedTick);
  const derivedMcapUsd = (tokenIsZero ? seedRatio : 1 / seedRatio) * nativeUsdFloat * supplyFloat;
  return { sqrtPriceX96, tickLower, tickUpper, feeTier, tickSpacing: spacing, seedTick, derivedMcapUsd };
}
function computeFairLaunchParams(opts) {
  const { targetMcapUsd, supplyTokens, nativeUsdPrice, tokenIsZero, bandWidthMultiplier = 25 } = opts;
  if (bandWidthMultiplier <= 1) throw new ValidationError("bandWidthMultiplier", "must be > 1");
  if (supplyTokens <= 0n) throw new ValidationError("supplyTokens", "must be > 0");
  if (nativeUsdPrice <= 0n) throw new ValidationError("nativeUsdPrice", "must be > 0 (stale or unset keeper price)");
  const pricePerTokenUsd1e18 = targetMcapUsd * 10n ** 18n / supplyTokens;
  const num = tokenIsZero ? pricePerTokenUsd1e18 : nativeUsdPrice;
  const den = tokenIsZero ? nativeUsdPrice : pricePerTokenUsd1e18;
  const seedSqrtPriceX96 = isqrt(num * 2n ** 192n / den);
  const seedSqrtP = Number(seedSqrtPriceX96) / Number(2n ** 96n);
  const priceRatioRaw = seedSqrtP * seedSqrtP;
  const seedTick = Math.round(Math.log(priceRatioRaw) / Math.log(1.0001) / RH_TICK_SPACING) * RH_TICK_SPACING;
  const offset = Math.round(Math.log(bandWidthMultiplier) / Math.log(1.0001) / RH_TICK_SPACING) * RH_TICK_SPACING;
  const tickLower = tokenIsZero ? seedTick : seedTick - offset;
  const tickUpper = tokenIsZero ? seedTick + offset : seedTick;
  const boundaryTick = tokenIsZero ? tickLower : tickUpper;
  const rawSqrt = Math.pow(1.0001, boundaryTick / 2) * Math.pow(2, 96);
  const sqrtPriceX96 = tokenIsZero ? BigInt(Math.floor(rawSqrt)) - 2n : BigInt(Math.ceil(rawSqrt)) + 2n;
  const sqrtA = Math.pow(1.0001, tickLower / 2);
  const sqrtB = Math.pow(1.0001, tickUpper / 2);
  const supplyFloat = Number(supplyTokens);
  const L = tokenIsZero ? supplyFloat / (1 / sqrtA - 1 / sqrtB) : supplyFloat / (sqrtB - sqrtA);
  if (!(L > 0) || !isFinite(L)) throw new ValidationError("liquidityDelta", `computed non-positive/invalid liquidityDelta (L=${L})`);
  const nativeUsdFloat = Number(nativeUsdPrice) / 1e18;
  const derivedMcapUsd = (tokenIsZero ? seedSqrtP * seedSqrtP : 1 / (seedSqrtP * seedSqrtP)) * nativeUsdFloat * supplyFloat;
  return {
    sqrtPriceX96,
    tickLower,
    tickUpper,
    liquidityDelta: parseEther(L.toFixed(18)),
    seedTick,
    derivedMcapUsd
  };
}

// src/modules/stock.ts
var ZERO_ADDRESS5 = "0x0000000000000000000000000000000000000000";
var isDeployed = (a) => !!a && a !== ZERO_ADDRESS5;
var STOCK_TARGET_MCAP_USD = 5500n;
var MIN_TAX_BPS = 200;
var MAX_TAX_BPS = 500;
var DEFAULT_TAX_BPS = 400;
var CREATOR_FEE_BPS = 50;
var FLYWHEEL_BPS = 10;
var PLATFORM_NET_BPS = 40;
var FIXED_CUT_BPS = CREATOR_FEE_BPS + FLYWHEEL_BPS + PLATFORM_NET_BPS;
var WEIGHT_TOTAL_BPS = 1e4;
var STOCK_V4_FEE_TIER = 1e4;
var STOCK_V4_TICK_SPACING = 200;
var STOCK_V4_GUARD_WINDOW_SECS = 180n;
var STOCK_UNIVERSE = [
  { symbol: "NVDA", name: "NVIDIA", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", liquidity: true },
  { symbol: "AAPL", name: "Apple", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", liquidity: false },
  { symbol: "TSLA", name: "Tesla", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38", liquidity: false }
];
var DEFAULT_REWARD_SYMBOL = "NVDA";
function stockBySymbol(symbol) {
  return STOCK_UNIVERSE.find((s) => s.symbol.toUpperCase() === symbol.toUpperCase());
}
function splitForTax(taxBps) {
  const clamped = Math.max(MIN_TAX_BPS, Math.min(MAX_TAX_BPS, Math.round(taxBps)));
  return {
    taxBps: clamped,
    creatorBps: CREATOR_FEE_BPS,
    flywheelBps: FLYWHEEL_BPS,
    platformBps: PLATFORM_NET_BPS,
    holdersBps: Math.max(0, clamped - FIXED_CUT_BPS)
  };
}
function equalWeights(symbols) {
  const n = symbols.length;
  if (n === 0) return [];
  const base2 = Math.floor(100 / n);
  const rem = 100 - base2 * n;
  return symbols.map((symbol, i) => ({ symbol, weightPct: base2 + (i < rem ? 1 : 0) }));
}
function draftToBasketEntries(draft) {
  return draft.map((d) => {
    const ref = stockBySymbol(d.symbol);
    if (!ref) return null;
    return { stock: ref.token, weightBps: Math.round(d.weightPct * 100) };
  }).filter((e) => e !== null);
}
function buildStockLaunchParamsV4(args) {
  const initialBuyEth = args.initialBuyEth ?? 0n;
  const initialBuyMinOut = args.initialBuyMinOut ?? 0n;
  const initialBuyLimitSqrtPriceX96 = args.tokenIsZero ? V3_MAX_SQRT_RATIO : V3_MIN_SQRT_RATIO;
  return {
    name: args.name,
    symbol: args.symbol,
    supply: args.supply,
    creatorAmount: args.creatorAmount ?? 0n,
    // pure fair launch by default
    sqrtPriceX96: args.sqrtPriceX96,
    tickLower: args.tickLower,
    tickUpper: args.tickUpper,
    fee: args.fee ?? STOCK_V4_FEE_TIER,
    tickSpacing: args.tickSpacing ?? STOCK_V4_TICK_SPACING,
    admin: args.admin,
    creator: args.creator,
    buyBps: args.buyBps,
    sellBps: args.sellBps,
    guardWindowSecs: args.guardWindowSecs ?? STOCK_V4_GUARD_WINDOW_SECS,
    initialBuyEth,
    initialBuyMinOut,
    initialBuyLimitSqrtPriceX96
  };
}
var StockRewardModule = class {
  constructor(addresses, chainId, publicClient, walletClient) {
    this.addresses = addresses;
    this.chainId = chainId;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  addresses;
  chainId;
  publicClient;
  walletClient;
  /** Whether the stock-reward suite is deployed on the client's chain. */
  get available() {
    return !!this.addresses && isDeployed(this.addresses.launcherV4) || !!this.addresses && isDeployed(this.addresses.launcherV2);
  }
  requireDeployed(op) {
    if (!this.addresses) {
      throw new ContractCallError(
        "StockRewardLauncher",
        op,
        `stock-reward launches are Robinhood-only (chain 4663) \u2014 not deployed on chain ${this.chainId}`
      );
    }
    return this.addresses;
  }
  requireWallet(op) {
    if (!this.walletClient) throw new WalletRequiredError(op);
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError(`${op} (no account)`);
    return account;
  }
  // ── Static reward data ────────────────────────────────────────────────────
  /** The selectable reward universe (tokenized stocks + Chainlink feeds). */
  getRewardUniverse() {
    return STOCK_UNIVERSE;
  }
  /** Look up a reward stock by symbol (case-insensitive). */
  stockBySymbol(symbol) {
    return stockBySymbol(symbol);
  }
  /** Preview how a per-side tax (bps) splits between creator/flywheel/platform + holders. */
  previewFeeSplit(taxBps) {
    return splitForTax(taxBps);
  }
  // ── Reads: vault ──────────────────────────────────────────────────────────
  /** The creator's chosen reward basket for a token (weights in bps, summing to 10000). */
  async getBasket(rewardToken) {
    const a = this.requireDeployed("getBasket");
    const res = await this.publicClient.readContract({
      address: a.vault,
      abi: StockRewardVaultABI,
      functionName: "getBasket",
      args: [rewardToken]
    });
    return res.map((e) => ({ stock: e.stock, weightBps: Number(e.weightBps) }));
  }
  /** Whether a stock is on the vault's reward allowlist. */
  async isStockAllowed(stock) {
    const a = this.requireDeployed("stockAllowed");
    return this.publicClient.readContract({
      address: a.vault,
      abi: StockRewardVaultABI,
      functionName: "stockAllowed",
      args: [stock]
    });
  }
  /** The Chainlink USD feed (8dp) the vault has bound to a stock. */
  async getStockPriceFeed(stock) {
    const a = this.requireDeployed("priceFeed");
    return this.publicClient.readContract({
      address: a.vault,
      abi: StockRewardVaultABI,
      functionName: "priceFeed",
      args: [stock]
    });
  }
  /** The undistributed holder USDG pool accrued for a reward token. */
  async getHolderPool(rewardToken) {
    const a = this.requireDeployed("holderUsdgPool");
    return this.publicClient.readContract({
      address: a.vault,
      abi: StockRewardVaultABI,
      functionName: "holderUsdgPool",
      args: [rewardToken]
    });
  }
  /** Total holder USDG the vault is currently holding across all tokens. */
  async getTotalHolderUsdg() {
    const a = this.requireDeployed("totalHolderUsdg");
    return this.publicClient.readContract({
      address: a.vault,
      abi: StockRewardVaultABI,
      functionName: "totalHolderUsdg"
    });
  }
  /** Total of a given stock the vault has bought for holders so far. */
  async getTotalStockBought(stock) {
    const a = this.requireDeployed("totalStockBought");
    return this.publicClient.readContract({
      address: a.vault,
      abi: StockRewardVaultABI,
      functionName: "totalStockBought",
      args: [stock]
    });
  }
  /**
   * The live WETH/USD price floor the vault prices stock buys against, read from the
   * WethUsdAggregatorAdapter (a Chainlink-shaped feed wrapping the keeper price). `answer` is
   * `decimals`-scaled (8dp). Returns zeros when the underlying keeper price is stale/bad
   * (the adapter fails CLOSED).
   */
  async getWethUsdPrice() {
    const a = this.requireDeployed("wethUsd");
    const [round, decimals] = await Promise.all([
      this.publicClient.readContract({
        address: a.wethUsdAdapter,
        abi: WethUsdAggregatorABI,
        functionName: "latestRoundData"
      }),
      this.publicClient.readContract({
        address: a.wethUsdAdapter,
        abi: WethUsdAggregatorABI,
        functionName: "decimals"
      })
    ]);
    return { answer: round[1], decimals: Number(decimals), updatedAt: Number(round[3]) };
  }
  // ── Reads: launcher ───────────────────────────────────────────────────────
  /** Whether `token` was launched via the V4 stock-reward launcher. */
  async isStockRewardToken(token) {
    const a = this.requireDeployed("isStockRewardToken");
    return this.publicClient.readContract({
      address: a.launcherV4,
      abi: StockRewardLauncherV4ABI,
      functionName: "isStockRewardToken",
      args: [token]
    });
  }
  /** Total number of V4 stock-reward launches to date. */
  async getLaunchCount() {
    const a = this.requireDeployed("launchCount");
    return this.publicClient.readContract({
      address: a.launcherV4,
      abi: StockRewardLauncherV4ABI,
      functionName: "launchCount"
    });
  }
  // ── Launch (build + write) ────────────────────────────────────────────────
  /**
   * Compute the full `StockRewardLauncherV4.LaunchParams` tuple (weth read + token prediction +
   * live keeper price + ticks/sqrtPrice) WITHOUT sending. Useful for previewing or custom flows.
   */
  async buildLaunchParamsV4(opts) {
    const a = this.requireDeployed("buildLaunchParamsV4");
    if (!isDeployed(a.launcherV4)) {
      throw new ContractCallError("StockRewardLauncherV4", "launch", "V4 launcher not deployed \u2014 use the V2 path");
    }
    const account = this.walletClient?.account?.address;
    const creator = opts.creator ?? account;
    if (!creator) throw new ValidationError("creator", "provide `creator` or a wallet client");
    const admin = opts.admin ?? creator;
    const buyBps = opts.buyBps ?? DEFAULT_TAX_BPS;
    const sellBps = opts.sellBps ?? DEFAULT_TAX_BPS;
    if (buyBps < MIN_TAX_BPS || buyBps > MAX_TAX_BPS || sellBps < MIN_TAX_BPS || sellBps > MAX_TAX_BPS) {
      throw new ValidationError("taxBps", `buy/sell tax must be within [${MIN_TAX_BPS}, ${MAX_TAX_BPS}] bps`);
    }
    const targetMcapUsd = opts.targetMcapUsd ?? STOCK_TARGET_MCAP_USD;
    const supplyTokens = opts.supplyTokens;
    const supplyWei = supplyTokens * 10n ** 18n;
    const launcher = a.launcherV4;
    const weth = await this.publicClient.readContract({
      address: launcher,
      abi: StockRewardLauncherV4ABI,
      functionName: "weth"
    });
    const nonce = await this.publicClient.getTransactionCount({ address: launcher });
    const predictedToken = getContractAddress({ from: launcher, nonce: BigInt(nonce) });
    const tokenIsZero = predictedToken.toLowerCase() < weth.toLowerCase();
    const { nativeUsdPrice } = await this.readKeeperPrice(a.bondingCurve);
    const fp = computeV3FairLaunchParams({
      targetMcapUsd,
      supplyTokens,
      nativeUsdPrice,
      tokenIsZero,
      feeTier: V3_DEFAULT_FEE_TIER
    });
    if (fp.tickLower % STOCK_V4_TICK_SPACING !== 0 || fp.tickUpper % STOCK_V4_TICK_SPACING !== 0 || fp.tickLower >= fp.tickUpper) {
      throw new ValidationError("ticks", "computed tick range is invalid for this DEX \u2014 try again");
    }
    let initialBuyEth = 0n;
    let initialBuyMinOut = 0n;
    if (opts.devBuyEth && opts.devBuyEth > 0) {
      initialBuyEth = parseEther(opts.devBuyEth.toString());
      const nativeUsdFloat = Number(nativeUsdPrice) / 1e18;
      const supplyNum = Number(supplyTokens);
      const seedPriceNative = nativeUsdFloat > 0 && supplyNum > 0 ? Number(targetMcapUsd) / supplyNum / nativeUsdFloat : 0;
      if (seedPriceNative > 0) {
        const expectedTokens = Number(formatEther(initialBuyEth)) / seedPriceNative;
        const floorTokens = expectedTokens * 0.5;
        if (Number.isFinite(floorTokens) && floorTokens > 0) initialBuyMinOut = parseEther(floorTokens.toFixed(18));
      }
      if (initialBuyMinOut <= 0n) throw new ValidationError("devBuyEth", "could not derive a safe minimum for the dev buy");
    }
    const params = buildStockLaunchParamsV4({
      name: opts.name,
      symbol: opts.symbol.toUpperCase(),
      supply: supplyWei,
      admin,
      creator,
      buyBps,
      sellBps,
      sqrtPriceX96: fp.sqrtPriceX96,
      tickLower: fp.tickLower,
      tickUpper: fp.tickUpper,
      tokenIsZero,
      guardWindowSecs: opts.guardWindowSecs,
      initialBuyEth,
      initialBuyMinOut
    });
    return { params, predictedToken, tokenIsZero };
  }
  /**
   * Launch a stock-reward token. Defaults to the V4 (WETH-paired, hook-taxed) launcher; pass
   * `useV2: true` (or launch on a chain where only V2 is deployed) for the legacy v3 path.
   * Requires a wallet client. Returns the launched token + poolId (decoded from `Launched`).
   */
  async launch(opts) {
    const a = this.requireDeployed("launch");
    const account = this.requireWallet("stock.launch");
    const useV4 = !opts.useV2 && isDeployed(a.launcherV4);
    if (useV4) {
      const { params: params2 } = await this.buildLaunchParamsV4(opts);
      return this.launchV4(params2, params2.initialBuyEth);
    }
    if (!isDeployed(a.launcherV2)) {
      throw new ContractCallError("StockRewardLauncherV2", "launch", "legacy V2 launcher not deployed on this chain");
    }
    const creator = opts.creator ?? account.address;
    const admin = opts.admin ?? creator;
    const buyBps = opts.buyBps ?? DEFAULT_TAX_BPS;
    const sellBps = opts.sellBps ?? DEFAULT_TAX_BPS;
    const targetMcapUsd = opts.targetMcapUsd ?? STOCK_TARGET_MCAP_USD;
    const supplyWei = opts.supplyTokens * 10n ** 18n;
    const weth = await this.publicClient.readContract({
      address: a.launcherV2,
      abi: StockRewardLauncherV2ABI,
      functionName: "weth"
    });
    const nonce = await this.publicClient.getTransactionCount({ address: a.launcherV2 });
    const predictedToken = getContractAddress({ from: a.launcherV2, nonce: BigInt(nonce) });
    const tokenIsZero = predictedToken.toLowerCase() < weth.toLowerCase();
    const { nativeUsdPrice } = await this.readKeeperPrice(a.bondingCurve);
    const fp = computeV3FairLaunchParams({ targetMcapUsd, supplyTokens: opts.supplyTokens, nativeUsdPrice, tokenIsZero, feeTier: V3_DEFAULT_FEE_TIER });
    const params = {
      name: opts.name,
      symbol: opts.symbol.toUpperCase(),
      supply: supplyWei,
      creatorAmount: 0n,
      tickLower: fp.tickLower,
      tickUpper: fp.tickUpper,
      admin,
      creator,
      vault: a.vault,
      buyBps,
      sellBps,
      dex: opts.dex ?? 0,
      initialBuyEth: 0n,
      initialBuyMinOut: 0n,
      initialBuyDeadline: 0n
    };
    return this.launchV2(params, predictedToken);
  }
  /** Send a prebuilt V4 launch tuple. `value` funds the atomic dev buy (defaults to initialBuyEth). */
  async launchV4(params, value) {
    const a = this.requireDeployed("launchV4");
    const account = this.requireWallet("stock.launchV4");
    const hash = await this.walletClient.writeContract({
      address: a.launcherV4,
      abi: StockRewardLauncherV4ABI,
      functionName: "launch",
      args: [params],
      value: value ?? params.initialBuyEth,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new ContractCallError("StockRewardLauncherV4", "launch", "reverted on-chain");
    let token = ZERO_ADDRESS5;
    let pool = "0x" + "0".repeat(64);
    let seededToPool = 0n;
    let toCreator = 0n;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: StockRewardLauncherV4ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "Launched") {
          const args = decoded.args;
          token = args.token;
          pool = args.poolId;
          seededToPool = args.seededToPool;
          toCreator = args.toCreator;
          break;
        }
      } catch {
      }
    }
    if (token === ZERO_ADDRESS5) throw new ContractCallError("StockRewardLauncherV4", "launch", "Launched event not found in receipt");
    let positionId;
    try {
      const info = await this.publicClient.readContract({
        address: a.launcherV4,
        abi: StockRewardLauncherV4ABI,
        functionName: "getLaunchByToken",
        args: [token]
      });
      positionId = info.positionId;
    } catch {
    }
    return { token, pool, positionId, seededToPool, toCreator, txResult: this.toTx(receipt) };
  }
  /** Send a prebuilt legacy V2 launch tuple. `predictedToken` is a receipt-decode fallback. */
  async launchV2(params, predictedToken) {
    const a = this.requireDeployed("launchV2");
    const account = this.requireWallet("stock.launchV2");
    const hash = await this.walletClient.writeContract({
      address: a.launcherV2,
      abi: StockRewardLauncherV2ABI,
      functionName: "launch",
      args: [params],
      value: params.initialBuyEth,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new ContractCallError("StockRewardLauncherV2", "launch", "reverted on-chain");
    let token = ZERO_ADDRESS5;
    let pool = ZERO_ADDRESS5;
    let seededToPool = 0n;
    let toCreator = 0n;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: StockRewardLauncherV2ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "Launched") {
          const args = decoded.args;
          token = args.token;
          pool = args.pool;
          seededToPool = args.seededToPool;
          toCreator = args.toCreator;
          break;
        }
      } catch {
      }
    }
    if (token === ZERO_ADDRESS5 && predictedToken) token = predictedToken;
    if (token === ZERO_ADDRESS5) throw new ContractCallError("StockRewardLauncherV2", "launch", "Launched event not found in receipt");
    return { token, pool, seededToPool, toCreator, txResult: this.toTx(receipt) };
  }
  // ── Claim (Merkle distributor) ────────────────────────────────────────────
  /** Number of published reward epochs. */
  async getEpochCount() {
    const a = this.requireDeployed("epochCount");
    return this.publicClient.readContract({
      address: a.distributor,
      abi: MerkleStockDistributorABI,
      functionName: "epochCount"
    });
  }
  /** Read a published epoch. */
  async getEpoch(epoch) {
    const a = this.requireDeployed("epochs");
    const e = await this.publicClient.readContract({
      address: a.distributor,
      abi: MerkleStockDistributorABI,
      functionName: "epochs",
      args: [epoch]
    });
    return {
      epoch: Number(epoch),
      stock: e[0],
      root: e[1],
      totalAmount: e[2],
      claimedAmount: e[3],
      createdAt: Number(e[4]),
      claimDeadline: Number(e[5]),
      closed: e[6]
    };
  }
  /** Whether `account` has claimed its leaf for an epoch. */
  async hasClaimed(epoch, account) {
    const a = this.requireDeployed("hasClaimed");
    return this.publicClient.readContract({
      address: a.distributor,
      abi: MerkleStockDistributorABI,
      functionName: "hasClaimed",
      args: [epoch, account]
    });
  }
  /** Amount still unclaimed for an epoch. */
  async getUnclaimed(epoch) {
    const a = this.requireDeployed("unclaimed");
    return this.publicClient.readContract({
      address: a.distributor,
      abi: MerkleStockDistributorABI,
      functionName: "unclaimed",
      args: [epoch]
    });
  }
  /**
   * Claim tokenized-stock rewards for an epoch. The Merkle `proof` is NOT computed on-chain — it
   * comes from the keeper's off-chain epoch state (the indexer / claim API); the caller supplies
   * it. Uses `claimFor` when `params.account` is set, otherwise `claim` for the wallet account.
   */
  async claim(params) {
    const a = this.requireDeployed("claim");
    const account = this.requireWallet("stock.claim");
    if (!params.proof || params.proof.length === 0) {
      throw new ValidationError("proof", "a Merkle proof (from the keeper/indexer) is required to claim");
    }
    const hash = params.account ? await this.walletClient.writeContract({
      address: a.distributor,
      abi: MerkleStockDistributorABI,
      functionName: "claimFor",
      args: [params.epoch, params.account, params.stock, params.amount, params.proof],
      account,
      chain: this.walletClient.chain
    }) : await this.walletClient.writeContract({
      address: a.distributor,
      abi: MerkleStockDistributorABI,
      functionName: "claim",
      args: [params.epoch, params.stock, params.amount, params.proof],
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new ContractCallError("MerkleStockDistributor", "claim", "reverted on-chain");
    return this.toTx(receipt);
  }
  // ── internals ─────────────────────────────────────────────────────────────
  /** Read the live native/USD keeper price + fail closed on staleness. */
  async readKeeperPrice(bondingCurve) {
    const [nativeUsdPrice, updatedAt, maxStale] = await Promise.all([
      this.publicClient.readContract({ address: bondingCurve, abi: StockKeeperABI, functionName: "keeperPriceUsd" }),
      this.publicClient.readContract({ address: bondingCurve, abi: StockKeeperABI, functionName: "keeperPriceUpdatedAt" }),
      this.publicClient.readContract({ address: bondingCurve, abi: StockKeeperABI, functionName: "maxPriceStale" })
    ]);
    if (Math.floor(Date.now() / 1e3) - Number(updatedAt) > Number(maxStale)) {
      throw new ContractCallError("BondingCurve", "keeperPriceUsd", "live price feed is stale right now \u2014 try again in a moment");
    }
    if (nativeUsdPrice <= 0n) throw new ContractCallError("BondingCurve", "keeperPriceUsd", "keeper price unset");
    return { nativeUsdPrice };
  }
  toTx(receipt) {
    return { hash: receipt.transactionHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
  }
};

// src/abis/RHLaunchpad.ts
var RHLaunchpadABI = [
  {
    name: "launch",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "supply", type: "uint256" },
      { name: "liquidityTokenAmount", type: "uint256" },
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidityDelta", type: "int256" }
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "poolId", type: "bytes32" }
    ]
  },
  {
    name: "devBuy",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" }
        ]
      },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
      { name: "recipient", type: "address" }
    ],
    outputs: [{ name: "boughtAmount", type: "uint256" }]
  },
  {
    name: "launchHook",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  // Live native-denominated launch fee (USD-pegged, derived from the BondingCurve's keeper
  // price). launch()'s msg.value must be >= this; any remainder is wrapped as pool-side WETH.
  {
    name: "effectiveLaunchFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "TokenCreated",
    type: "event",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "initialSupply", type: "uint256", indexed: false }
    ]
  },
  {
    name: "DevBuyExecuted",
    type: "event",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "wethIn", type: "uint256", indexed: false },
      { name: "tokenOut", type: "uint256", indexed: false }
    ]
  }
];

// src/modules/quicklaunch.ts
var ZERO_ADDRESS6 = "0x0000000000000000000000000000000000000000";
var isDeployed2 = (a) => !!a && a !== ZERO_ADDRESS6;
var QUICK_LAUNCH_TARGET_MCAP_USD = 5500n;
var QUICK_LAUNCH_FEE_TIER = 3e3;
var QUICK_LAUNCH_TICK_SPACING = RH_TICK_SPACING;
var QuickLaunchModule = class {
  constructor(addresses, chainId, publicClient, walletClient) {
    this.addresses = addresses;
    this.chainId = chainId;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }
  addresses;
  chainId;
  publicClient;
  walletClient;
  /** Whether RHLaunchpad quick launch is deployed on the client's chain. */
  get available() {
    return !!this.addresses && isDeployed2(this.addresses.launchpad);
  }
  /** The RHLaunchpad address this module targets (zero if not deployed on this chain). */
  get launchpadAddress() {
    return this.addresses?.launchpad ?? ZERO_ADDRESS6;
  }
  requireDeployed(op) {
    if (!this.addresses || !isDeployed2(this.addresses.launchpad)) {
      throw new ContractCallError(
        "RHLaunchpad",
        op,
        `quick launch (RHLaunchpad) is Robinhood-only (chain 4663) \u2014 not deployed on chain ${this.chainId}`
      );
    }
    return this.addresses;
  }
  requireWallet(op) {
    if (!this.walletClient) throw new WalletRequiredError(op);
    const account = this.walletClient.account;
    if (!account) throw new WalletRequiredError(`${op} (no account)`);
    return account;
  }
  // ── Reads ─────────────────────────────────────────────────────────────────
  /** Live native-denominated launch fee (wei), USD-pegged at the keeper price. `launch()` sends this. */
  async getEffectiveLaunchFee() {
    const a = this.requireDeployed("effectiveLaunchFee");
    return this.publicClient.readContract({
      address: a.launchpad,
      abi: RHLaunchpadABI,
      functionName: "effectiveLaunchFee"
    });
  }
  /** The shared LaunchHook attached to every RHLaunchpad pool. */
  async getLaunchHook() {
    const a = this.requireDeployed("launchHook");
    return this.publicClient.readContract({
      address: a.launchpad,
      abi: RHLaunchpadABI,
      functionName: "launchHook"
    });
  }
  // ── Build (compute launch args without sending) ────────────────────────────
  /**
   * Compute the ready-to-send RHLaunchpad `launch()` args (weth read + token prediction + live
   * keeper price + single-sided seed geometry + USD-pegged launch fee) WITHOUT sending.
   */
  async buildLaunchParams(opts) {
    const a = this.requireDeployed("buildLaunchParams");
    const targetMcapUsd = opts.targetMcapUsd ?? QUICK_LAUNCH_TARGET_MCAP_USD;
    const nonce = await this.publicClient.getTransactionCount({ address: a.launchpad });
    const predictedToken = getContractAddress({ from: a.launchpad, nonce: BigInt(nonce) });
    const tokenIsZero = predictedToken.toLowerCase() < a.weth.toLowerCase();
    const nativeUsdPrice = await this.readKeeperPrice(a.bondingCurve);
    const params = computeFairLaunchParams({
      targetMcapUsd,
      supplyTokens: opts.supplyTokens,
      nativeUsdPrice,
      tokenIsZero
    });
    const launchFee = await this.publicClient.readContract({
      address: a.launchpad,
      abi: RHLaunchpadABI,
      functionName: "effectiveLaunchFee"
    });
    return { predictedToken, tokenIsZero, launchFee, params };
  }
  // ── Launch (write) ─────────────────────────────────────────────────────────
  /**
   * Deploy a token and single-sided-seed 100% of its supply into a fresh v4 pool. `msg.value`
   * covers the live USD-pegged launch fee (no WETH needed to seed a single-sided position).
   * Requires a wallet client. Returns the launched token (decoded from `TokenCreated`).
   */
  async launch(opts) {
    const a = this.requireDeployed("launch");
    const account = this.requireWallet("quickLaunch.launch");
    if (opts.supplyTokens <= 0n) throw new ValidationError("supplyTokens", "must be > 0");
    const built = await this.buildLaunchParams(opts);
    const supplyWei = opts.supplyTokens * 10n ** 18n;
    const hash = await this.walletClient.writeContract({
      address: a.launchpad,
      abi: RHLaunchpadABI,
      functionName: "launch",
      args: [
        opts.name,
        opts.symbol.toUpperCase(),
        supplyWei,
        supplyWei,
        // fair launch: the FULL supply is the liquidityTokenAmount
        built.params.sqrtPriceX96,
        built.params.tickLower,
        built.params.tickUpper,
        built.params.liquidityDelta
      ],
      value: built.launchFee,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new ContractCallError("RHLaunchpad", "launch", "reverted on-chain");
    let token = ZERO_ADDRESS6;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: RHLaunchpadABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "TokenCreated") {
          token = decoded.args.token;
          break;
        }
      } catch {
      }
    }
    if (token === ZERO_ADDRESS6) token = built.predictedToken;
    return { token, derivedMcapUsd: built.params.derivedMcapUsd, txResult: this.toTx(receipt) };
  }
  /**
   * Buy into any LaunchHook pool once its 3-minute sniper guard has elapsed. The UI owns the
   * countdown; this just sends the swap (WETH-in). Requires a wallet client.
   */
  async devBuy(opts) {
    const a = this.requireDeployed("devBuy");
    const account = this.requireWallet("quickLaunch.devBuy");
    const hookAddr = await this.publicClient.readContract({
      address: a.launchpad,
      abi: RHLaunchpadABI,
      functionName: "launchHook"
    });
    const tokenIsZero = opts.token.toLowerCase() < a.weth.toLowerCase();
    const key = tokenIsZero ? { currency0: opts.token, currency1: a.weth, fee: QUICK_LAUNCH_FEE_TIER, tickSpacing: QUICK_LAUNCH_TICK_SPACING, hooks: hookAddr } : { currency0: a.weth, currency1: opts.token, fee: QUICK_LAUNCH_FEE_TIER, tickSpacing: QUICK_LAUNCH_TICK_SPACING, hooks: hookAddr };
    const amountIn = parseEther(opts.amountInEther.toString());
    const hash = await this.walletClient.writeContract({
      address: a.launchpad,
      abi: RHLaunchpadABI,
      functionName: "devBuy",
      args: [key, amountIn, tokenIsZero ? MAX_SQRT_RATIO : MIN_SQRT_RATIO, opts.recipient ?? account.address],
      value: amountIn,
      account,
      chain: this.walletClient.chain
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new ContractCallError("RHLaunchpad", "devBuy", "reverted on-chain");
    let boughtAmount = 0n;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: RHLaunchpadABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "DevBuyExecuted") {
          boughtAmount = decoded.args.tokenOut;
          break;
        }
      } catch {
      }
    }
    return { txResult: this.toTx(receipt), boughtAmount };
  }
  // ── internals ─────────────────────────────────────────────────────────────
  async readKeeperPrice(bondingCurve) {
    const [nativeUsdPrice, updatedAt, maxStale] = await Promise.all([
      this.publicClient.readContract({ address: bondingCurve, abi: StockKeeperABI, functionName: "keeperPriceUsd" }),
      this.publicClient.readContract({ address: bondingCurve, abi: StockKeeperABI, functionName: "keeperPriceUpdatedAt" }),
      this.publicClient.readContract({ address: bondingCurve, abi: StockKeeperABI, functionName: "maxPriceStale" })
    ]);
    if (Math.floor(Date.now() / 1e3) - Number(updatedAt) > Number(maxStale)) {
      throw new ContractCallError("BondingCurve", "keeperPriceUsd", "live price feed is stale right now \u2014 try again in a moment");
    }
    if (nativeUsdPrice <= 0n) throw new ContractCallError("BondingCurve", "keeperPriceUsd", "keeper price unset");
    return nativeUsdPrice;
  }
  toTx(receipt) {
    return { hash: receipt.transactionHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
  }
};

// src/client.ts
var CHAIN_DEFS = {
  8453: base,
  56: bsc,
  1: mainnet,
  999: {
    id: 999,
    name: "HyperEVM",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.hyperliquid.xyz/evm"] }
    }
  },
  4326: {
    id: 4326,
    name: "MegaETH",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://megaeth.drpc.org"] }
    }
  },
  4663: {
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://rpc.mainnet.chain.robinhood.com"] }
    }
  }
};
var DEFAULT_RPC = {
  8453: "https://mainnet.base.org",
  4663: "https://rpc.mainnet.chain.robinhood.com",
  4326: "https://megaeth.drpc.org",
  999: "https://rpc.hyperliquid.xyz/evm",
  56: "https://bsc-dataseed.binance.org",
  1: "https://ethereum-rpc.publicnode.com"
};
var HookOS = class {
  /** Token creation and querying. */
  tokens;
  /** Hook registration, attachment, and browsing. */
  hooks;
  /** Battle creation, wagering, and settlement. */
  arena;
  /** Protocol events. */
  events;
  /** Fee distribution management. */
  fees;
  /** Bonding curve trading (buy/sell/quotes). */
  trading;
  /** FeedBoost slot auction (read slots, place à la carte bids). */
  feedBoost;
  /**
   * HookOS V3 — direct-to-Uniswap-v3 (and HookSwap / PancakeSwap V3) fair launches + the buyback
   * flywheel. Live on all six chains; the module resolves the launcher for the client's chainId.
   */
  v3;
  /**
   * Stock-Reward launches — taxed fair launches whose tax buys REAL tokenized stocks for holders.
   * Robinhood Chain (4663) only — methods throw a clear error on other chains.
   */
  stock;
  /**
   * Quick Launch — RHLaunchpad direct-to-Uniswap-v4 memecoin fast path. Robinhood Chain (4663)
   * only — methods throw a clear error on other chains.
   */
  quickLaunch;
  /** The underlying viem PublicClient used for reads. */
  publicClient;
  /** The underlying viem WalletClient used for writes (if provided). */
  walletClient;
  /** The active chain ID. */
  chainId;
  constructor(opts = {}) {
    this.chainId = opts.chainId ?? 8453;
    this.walletClient = opts.walletClient;
    const chain = CHAIN_DEFS[this.chainId];
    if (!chain) throw new ChainError(this.chainId);
    if (opts.publicClient) {
      this.publicClient = opts.publicClient;
    } else {
      const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC[this.chainId] ?? DEFAULT_RPC[8453];
      this.publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl)
      });
    }
    const addresses = getAddresses(this.chainId);
    this.tokens = new TokenModule(addresses.tokenFactory, this.publicClient, this.walletClient);
    this.hooks = new HookModule(addresses.hookRegistry, addresses.hookManager, this.publicClient, this.walletClient);
    this.arena = new ArenaModule(addresses.arena, this.publicClient, this.walletClient);
    this.events = new EventsModule(addresses.events, this.publicClient, this.walletClient);
    this.fees = new FeeModule(addresses.feeRouter, this.publicClient, this.walletClient);
    this.trading = new TradingModule(addresses.bondingCurve, this.publicClient, this.walletClient);
    this.feedBoost = new FeedBoostModule(addresses.feedBoostAuction, this.publicClient, this.walletClient);
    const v3Addrs = getHookOSV3Addresses(this.chainId) ?? HOOKOS_V3_ADDRESSES;
    this.v3 = new V3LaunchModule(v3Addrs, this.publicClient, this.walletClient);
    this.stock = new StockRewardModule(
      getStockRewardAddresses(this.chainId),
      this.chainId,
      this.publicClient,
      this.walletClient
    );
    this.quickLaunch = new QuickLaunchModule(
      getQuickLaunchAddresses(this.chainId),
      this.chainId,
      this.publicClient,
      this.walletClient
    );
  }
};

// src/rpc.ts
var RPC_ENDPOINTS = {
  // Base
  8453: [
    "https://gateway.tenderly.co/public/base",
    "https://mainnet.base.org",
    "https://base-rpc.publicnode.com",
    "https://base-mainnet.public.blastapi.io",
    "https://base.gateway.tenderly.co",
    "https://base-pokt.nodies.app",
    "https://base.publicnode.com",
    "https://base.meowrpc.com"
  ],
  // Robinhood Chain
  4663: [
    "https://rpc.mainnet.chain.robinhood.com"
  ],
  // BNB Chain
  56: [
    "https://bsc-dataseed2.binance.org",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc-dataseed1.ninicoin.io",
    "https://bsc.publicnode.com",
    "https://bsc-mainnet.public.blastapi.io",
    "https://bsc-dataseed.binance.org",
    "https://bsc-rpc.publicnode.com",
    "https://bsc.meowrpc.com"
  ],
  // Ethereum
  1: [
    "https://eth.drpc.org",
    "https://mainnet.gateway.tenderly.co",
    "https://eth-mainnet.public.blastapi.io",
    "https://rpc.flashbots.net",
    "https://ethereum-rpc.publicnode.com",
    "https://eth.rpc.blxrbdn.com",
    "https://eth.meowrpc.com"
  ],
  // HyperEVM
  999: [
    "https://hyperliquid.drpc.org",
    "https://rpc.hyperliquid.xyz/evm",
    "https://hyperliquid-json-rpc.stakely.io"
  ],
  // MegaETH
  4326: [
    "https://mainnet.megaeth.com/rpc",
    "https://megaeth.drpc.org"
  ]
};
function getRpcPool(chainId, overrides = []) {
  const pool = RPC_ENDPOINTS[chainId] ?? [];
  return [.../* @__PURE__ */ new Set([...overrides.filter(Boolean), ...pool])];
}

export { ADDRESSES, ArenaABI, ArenaModule, BattleStatus, BondingCurveABI, CREATOR_FEE_BPS, ChainError, ContractCallError, DEFAULT_REWARD_SYMBOL, DEFAULT_TAX_BPS, EventStatus, EventsABI, EventsModule, FIXED_CUT_BPS, FLYWHEEL_BPS, FeeModule, FeeRouterABI, FeedBoostAuctionABI, FeedBoostModule, HOOKOS_V3_ADDRESSES, HOOKOS_V3_ADDRESSES_BY_CHAIN, HOOKOS_V3_CHAIN_ID, HOOKOS_V3_SUPPORTED_CHAIN_IDS, HookManagerABI, HookModule, HookOS, HookOSError, HookOSV3BuybackABI, HookOSV3FeeVaultABI, HookOSV3LauncherABI, HookPoint, HookRegistryABI, IndexerError, MAX_SQRT_RATIO, MAX_TAX_BPS, MIN_SQRT_RATIO, MIN_TAX_BPS, MerkleStockDistributorABI, PLATFORM_NET_BPS, QUICK_LAUNCH_ADDRESSES, QUICK_LAUNCH_CHAIN_ID, QUICK_LAUNCH_FEE_TIER, QUICK_LAUNCH_TARGET_MCAP_USD, QUICK_LAUNCH_TICK_SPACING, QuickLaunchModule, RHLaunchpadABI, RH_TICK_SPACING, RPC_ENDPOINTS, RewardMode, STOCK_REWARD_ADDRESSES, STOCK_REWARD_CHAIN_ID, STOCK_TARGET_MCAP_USD, STOCK_UNIVERSE, STOCK_V4_FEE_TIER, STOCK_V4_GUARD_WINDOW_SECS, STOCK_V4_TICK_SPACING, Side, StockKeeperABI, StockRewardLauncherV2ABI, StockRewardLauncherV4ABI, StockRewardModule, StockRewardVaultABI, TokenFactoryABI, TokenModule, TradingModule, TransactionError, V3Dex, V3LaunchModule, V3PairToken, V3_DEFAULT_FEE_TIER, V3_FEE_TIERS, V3_MAX_SQRT_RATIO, V3_MIN_SQRT_RATIO, V3_TICK_SPACING, ValidationError, WEIGHT_TOTAL_BPS, WalletRequiredError, WethUsdAggregatorABI, buildStockLaunchParamsV4, computeFairLaunchParams, computeV3FairLaunchParams, draftToBasketEntries, equalWeights, getAddresses, getHookOSV3Addresses, getQuickLaunchAddresses, getRpcPool, getStockRewardAddresses, splitForTax, stockBySymbol, tickSpacingForFee };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map