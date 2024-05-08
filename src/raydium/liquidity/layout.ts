import { GetStructureSchema, publicKey, seq, struct, u128, u64, u8, u16, blob, bool } from "@/marshmallow";

export const fixedSwapInLayout = struct([u8("instruction"), u64("amountIn"), u64("minAmountOut")]);
export const fixedSwapOutLayout = struct([u8("instruction"), u64("maxAmountIn"), u64("amountOut")]);

export const createPoolV4Layout = struct([u8("instruction"), u8("nonce")]);
export const initPoolLayout = struct([u8("instruction"), u8("nonce"), u64("startTime")]);
/* ================= state layouts ================= */
export const liquidityStateV4Layout = struct([
  u64("status"),
  u64("nonce"),
  u64("maxOrder"),
  u64("depth"),
  u64("baseDecimal"),
  u64("quoteDecimal"),
  u64("state"),
  u64("resetFlag"),
  u64("minSize"),
  u64("volMaxCutRatio"),
  u64("amountWaveRatio"),
  u64("baseLotSize"),
  u64("quoteLotSize"),
  u64("minPriceMultiplier"),
  u64("maxPriceMultiplier"),
  u64("systemDecimalValue"),
  u64("minSeparateNumerator"),
  u64("minSeparateDenominator"),
  u64("tradeFeeNumerator"),
  u64("tradeFeeDenominator"),
  u64("pnlNumerator"),
  u64("pnlDenominator"),
  u64("swapFeeNumerator"),
  u64("swapFeeDenominator"),
  u64("baseNeedTakePnl"),
  u64("quoteNeedTakePnl"),
  u64("quoteTotalPnl"),
  u64("baseTotalPnl"),
  u64("poolOpenTime"),
  u64("punishPcAmount"),
  u64("punishCoinAmount"),
  u64("orderbookToInitTime"),
  // u128('poolTotalDepositPc'),
  // u128('poolTotalDepositCoin'),
  u128("swapBaseInAmount"),
  u128("swapQuoteOutAmount"),
  u64("swapBase2QuoteFee"),
  u128("swapQuoteInAmount"),
  u128("swapBaseOutAmount"),
  u64("swapQuote2BaseFee"),
  // amm vault
  publicKey("baseVault"),
  publicKey("quoteVault"),
  // mint
  publicKey("baseMint"),
  publicKey("quoteMint"),
  publicKey("lpMint"),
  // market
  publicKey("openOrders"),
  publicKey("marketId"),
  publicKey("marketProgramId"),
  publicKey("targetOrders"),
  publicKey("withdrawQueue"),
  publicKey("lpVault"),
  publicKey("owner"),
  // true circulating supply without lock up
  u64("lpReserve"),
  seq(u64(), 3, "padding"),
]);

export type LiquidityStateLayoutV4 = typeof liquidityStateV4Layout;
export type LiquidityStateV4 = GetStructureSchema<LiquidityStateLayoutV4>;

export const liquidityStateV5Layout = struct([
  u64("accountType"),
  u64("status"),
  u64("nonce"),
  u64("maxOrder"),
  u64("depth"),
  u64("baseDecimal"),
  u64("quoteDecimal"),
  u64("state"),
  u64("resetFlag"),
  u64("minSize"),
  u64("volMaxCutRatio"),
  u64("amountWaveRatio"),
  u64("baseLotSize"),
  u64("quoteLotSize"),
  u64("minPriceMultiplier"),
  u64("maxPriceMultiplier"),
  u64("systemDecimalsValue"),
  u64("abortTradeFactor"),
  u64("priceTickMultiplier"),
  u64("priceTick"),
  // Fees
  u64("minSeparateNumerator"),
  u64("minSeparateDenominator"),
  u64("tradeFeeNumerator"),
  u64("tradeFeeDenominator"),
  u64("pnlNumerator"),
  u64("pnlDenominator"),
  u64("swapFeeNumerator"),
  u64("swapFeeDenominator"),
  // OutPutData
  u64("baseNeedTakePnl"),
  u64("quoteNeedTakePnl"),
  u64("quoteTotalPnl"),
  u64("baseTotalPnl"),
  u64("poolOpenTime"),
  u64("punishPcAmount"),
  u64("punishCoinAmount"),
  u64("orderbookToInitTime"),
  u128("swapBaseInAmount"),
  u128("swapQuoteOutAmount"),
  u128("swapQuoteInAmount"),
  u128("swapBaseOutAmount"),
  u64("swapQuote2BaseFee"),
  u64("swapBase2QuoteFee"),

  publicKey("baseVault"),
  publicKey("quoteVault"),
  publicKey("baseMint"),
  publicKey("quoteMint"),
  publicKey("lpMint"),

  publicKey("modelDataAccount"),
  publicKey("openOrders"),
  publicKey("marketId"),
  publicKey("marketProgramId"),
  publicKey("targetOrders"),
  publicKey("owner"),
  seq(u64(), 64, "padding"),
]);

export const addLiquidityLayout = struct([
  u8("instruction"),
  u64("baseAmountIn"),
  u64("quoteAmountIn"),
  u64("fixedSide"),
]);

export const removeLiquidityLayout = struct([u8("instruction"), u64("amountIn")]);

export type LiquidityStateLayoutV5 = typeof liquidityStateV5Layout;
export type LiquidityStateV5 = GetStructureSchema<LiquidityStateLayoutV5>;

export type LiquidityState = LiquidityStateV4 | LiquidityStateV5;
export type LiquidityStateLayout = LiquidityStateLayoutV4 | LiquidityStateLayoutV5;

/* ================= index ================= */
// version => liquidity state layout
export const LIQUIDITY_VERSION_TO_STATE_LAYOUT: {
  [version: number]: LiquidityStateLayout;
} = {
  4: liquidityStateV4Layout,
  5: liquidityStateV5Layout,
};

export const createPoolFeeLayout = struct([u64("fee")]);

export const CpmmConfigInfoLayout = struct([
  blob(8),
  u8("bump"),
  bool("disableCreatePool"),
  u16("index"),
  u64("tradeFeeRate"),
  u64("protocolFeeRate"),
  u64("fundFeeRate"),
  u64("createPoolFee"),

  publicKey("protocolOwner"),
  publicKey("fundOwner"),
  seq(u64(), 16),
]);

export const CpmmPoolInfoLayout = struct([
  blob(8),

  publicKey("configId"),
  publicKey("poolCreator"),
  publicKey("vaultA"),
  publicKey("vaultB"),

  publicKey("mintLp"),
  publicKey("mintA"),
  publicKey("mintB"),

  publicKey("mintProgramA"),
  publicKey("mintProgramB"),

  publicKey("observationId"),

  u8("bump"),
  u8("status"),

  u8("lpDecimals"),
  u8("mintDecimalA"),
  u8("mintDecimalB"),

  u64("lpAmount"),
  u64("protocolFeesMintA"),
  u64("protocolFeesMintB"),
  u64("fundFeesMintA"),
  u64("fundFeesMintB"),
  u64("openTime"),

  seq(u64(), 32),
]);
