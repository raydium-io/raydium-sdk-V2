export enum TxVersion {
  "V0",
  "LEGACY",
}

export enum InstructionType {
  "CreateAccount",
  "InitAccount",
  "CreateATA",
  "CloseAccount",
  "TransferAmount",
  "InitMint",
  "MintTo",

  "InitMarket", // create market main ins
  "Itil1216OwnerClaim", // owner claim token ins

  "SetComputeUnitPrice", // addComputeBudget
  "SetComputeUnitLimit", // addComputeBudget

  // CLMM
  "ClmmCreatePool",
  "ClmmOpenPosition",
  "ClmmIncreasePosition",
  "ClmmDecreasePosition",
  "ClmmClosePosition",
  "ClmmSwapBaseIn",
  "ClmmSwapBaseOut",
  "ClmmInitReward",
  "ClmmSetReward",
  "ClmmCollectReward",

  "AmmV4Swap",
  "AmmV4AddLiquidity",
  "AmmV4RemoveLiquidity",
  "AmmV4SimulatePoolInfo",
  "AmmV4SwapBaseIn",
  "AmmV4SwapBaseOut",
  "AmmV4CreatePool",
  "AmmV4InitPool",

  "AmmV5AddLiquidity",
  "AmmV5RemoveLiquidity",
  "AmmV5SimulatePoolInfo",
  "AmmV5SwapBaseIn",
  "AmmV5SwapBaseOut",

  "RouteSwap1",
  "RouteSwap2",

  "FarmV3Deposit",
  "FarmV3Withdraw",
  "FarmV3CreateLedger",

  "FarmV5Deposit",
  "FarmV5Withdraw",
  "FarmV5CreateLedger",

  "FarmV6Deposit",
  "FarmV6Withdraw",
  "FarmV6Create",
  "FarmV6Restart",
  "FarmV6CreatorAddReward",
  "FarmV6CreatorWithdraw",
}
