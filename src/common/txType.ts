export enum TxVersion {
  "V0",
  "LEGACY",
}

export enum InstructionType {
  "createAccount",
  "initAccount",
  "createATA",
  "closeAccount",
  "transferAmount",
  "initMint",
  "mintTo",

  "initMarket", // create market main ins
  "util1216OwnerClaim", // owner claim token ins

  "setComputeUnitPrice", // addComputeBudget
  "setComputeUnitLimit", // addComputeBudget

  // CLMM
  "clmmCreatePool",
  "clmmOpenPosition",
  "clmmIncreasePosition",
  "clmmDecreasePosition",
  "clmmClosePosition",
  "clmmSwapBaseIn",
  "clmmSwapBaseOut",
  "clmmInitReward",
  "clmmSetReward",
  "clmmCollectReward",

  "ammV4Swap",
  "ammV4AddLiquidity",
  "ammV4RemoveLiquidity",
  "ammV4SimulatePoolInfo",
  "ammV4SwapBaseIn",
  "ammV4SwapBaseOut",
  "ammV4CreatePool",
  "ammV4InitPool",

  "ammV5AddLiquidity",
  "ammV5RemoveLiquidity",
  "ammV5SimulatePoolInfo",
  "ammV5SwapBaseIn",
  "ammV5SwapBaseOut",

  "routeSwap1",
  "routeSwap2",

  "farmV3Deposit",
  "farmV3Withdraw",
  "farmV3CreateLedger",

  "farmV5Deposit",
  "farmV5Withdraw",
  "farmV5CreateLedger",

  "farmV6Deposit",
  "farmV6Withdraw",
  "farmV6Create",
  "farmV6Restart",
  "farmV6CreatorAddReward",
  "farmV6CreatorWithdraw",
}
