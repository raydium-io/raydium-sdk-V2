import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { AmmV4Keys, AmmV5Keys } from "@/api/type";
import { BN_ONE, BN_ZERO, parseBigNumberish } from "@/common";
import { createLogger } from "@/common/logger";
import { accountMeta, RENT_PROGRAM_ID } from "@/common/pubKey";
import { InstructionType } from "@/common/txTool/txType";
import { struct, u64, u8 } from "@/marshmallow";

import BN from "bn.js";
import { jsonInfo2PoolKeys } from "@/common/utility";
import { InstructionReturn } from "../type";
import {
  addLiquidityLayout,
  fixedSwapInLayout,
  fixedSwapOutLayout,
  initPoolLayout,
  removeLiquidityLayout,
} from "./layout";
import { MODEL_DATA_PUBKEY } from "./stable";
import {
  InitPoolInstructionParamsV4,
  LiquidityAddInstructionParams,
  RemoveLiquidityInstruction,
  SwapFixedInInstructionParamsV4,
  SwapFixedOutInstructionParamsV4,
  SwapInstructionParams,
} from "./type";

const logger = createLogger("Raydium_liquidity_instruction");
export function makeAddLiquidityInstruction(params: LiquidityAddInstructionParams): TransactionInstruction {
  const { poolInfo, poolKeys, userKeys, baseAmountIn, quoteAmountIn, fixedSide, otherAmountMin } = params;

  const data = Buffer.alloc(addLiquidityLayout.span);
  addLiquidityLayout.encode(
    {
      instruction: 3,
      baseAmountIn: parseBigNumberish(baseAmountIn),
      quoteAmountIn: parseBigNumberish(quoteAmountIn),
      otherAmountMin: parseBigNumberish(otherAmountMin),
      fixedSide: fixedSide === "base" ? BN_ZERO : BN_ONE,
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    // amm
    accountMeta({ pubkey: new PublicKey(poolInfo.id) }),
    accountMeta({ pubkey: new PublicKey(poolKeys.authority), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.openOrders), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.targetOrders) }),
    accountMeta({ pubkey: new PublicKey(poolInfo.lpMint.address) }),
    accountMeta({ pubkey: new PublicKey(poolKeys.vault.A) }),
    accountMeta({ pubkey: new PublicKey(poolKeys.vault.B) }),
  ];

  if (poolInfo.pooltype.includes("StablePool")) {
    keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));
  }

  keys.push(
    // serum
    accountMeta({ pubkey: new PublicKey(poolInfo.marketId), isWritable: false }),
    // user
    accountMeta({ pubkey: userKeys.baseTokenAccount }),
    accountMeta({ pubkey: userKeys.quoteTokenAccount }),
    accountMeta({ pubkey: userKeys.lpTokenAccount }),
    accountMeta({ pubkey: userKeys.owner, isWritable: false, isSigner: true }),
    accountMeta({ pubkey: new PublicKey(poolKeys.marketEventQueue), isWritable: false }),
  );

  return new TransactionInstruction({
    programId: new PublicKey(poolInfo.programId),
    keys,
    data,
  });
}

export function removeLiquidityInstruction(params: RemoveLiquidityInstruction): TransactionInstruction {
  const { poolInfo, poolKeys: poolKeyProps, userKeys, lpAmount, baseAmountMin, quoteAmountMin } = params;
  const poolKeys = jsonInfo2PoolKeys(poolKeyProps);

  let version = 4;
  if (poolInfo.pooltype.includes("StablePool")) version = 5;

  if (version === 4 || version === 5) {
    const data = Buffer.alloc(removeLiquidityLayout.span);
    removeLiquidityLayout.encode(
      {
        instruction: 4,
        lpAmount: parseBigNumberish(lpAmount),
        baseAmountMin: parseBigNumberish(baseAmountMin),
        quoteAmountMin: parseBigNumberish(quoteAmountMin),
      },
      data,
    );

    const keys = [
      // system
      accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
      // amm
      accountMeta({ pubkey: poolKeys.id }),
      accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
      accountMeta({ pubkey: poolKeys.openOrders }),
      accountMeta({ pubkey: poolKeys.targetOrders }),
      accountMeta({ pubkey: poolKeys.mintLp.address }),
      accountMeta({ pubkey: poolKeys.vault.A }),
      accountMeta({ pubkey: poolKeys.vault.B }),
    ];

    if (version === 5) {
      keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));
    } else {
      keys.push(accountMeta({ pubkey: poolKeys.id }));
      keys.push(accountMeta({ pubkey: poolKeys.id }));
    }

    keys.push(
      // serum
      accountMeta({ pubkey: poolKeys.marketProgramId, isWritable: false }),
      accountMeta({ pubkey: poolKeys.marketId }),
      accountMeta({ pubkey: poolKeys.marketBaseVault }),
      accountMeta({ pubkey: poolKeys.marketQuoteVault }),
      accountMeta({ pubkey: poolKeys.marketAuthority, isWritable: false }),
      // user
      accountMeta({ pubkey: userKeys.lpTokenAccount }),
      accountMeta({ pubkey: userKeys.baseTokenAccount }),
      accountMeta({ pubkey: userKeys.quoteTokenAccount }),
      accountMeta({ pubkey: userKeys.owner, isWritable: false, isSigner: true }),
      // serum orderbook
      accountMeta({ pubkey: poolKeys.marketEventQueue }),
      accountMeta({ pubkey: poolKeys.marketBids }),
      accountMeta({ pubkey: poolKeys.marketAsks }),
    );

    return new TransactionInstruction({
      programId: poolKeys.programId,
      keys,
      data,
    });
  }

  // logger.logWithError("invalid version", "poolKeys.version", version);
  return new TransactionInstruction({ programId: poolKeys.programId, keys: [] }); // won't reach
}

export function createPoolV4InstructionV2({
  programId,
  ammId,
  ammAuthority,
  ammOpenOrders,
  lpMint,
  coinMint,
  pcMint,
  coinVault,
  pcVault,
  withdrawQueue,
  ammTargetOrders,
  poolTempLp,
  marketProgramId,
  marketId,
  userWallet,
  userCoinVault,
  userPcVault,
  userLpVault,
  nonce,
  openTime,
  coinAmount,
  pcAmount,
  ammConfigId,
  feeDestinationId,
}: {
  programId: PublicKey;
  ammId: PublicKey;
  ammAuthority: PublicKey;
  ammOpenOrders: PublicKey;
  lpMint: PublicKey;
  coinMint: PublicKey;
  pcMint: PublicKey;
  coinVault: PublicKey;
  pcVault: PublicKey;
  withdrawQueue: PublicKey;
  ammTargetOrders: PublicKey;
  poolTempLp: PublicKey;
  marketProgramId: PublicKey;
  marketId: PublicKey;
  userWallet: PublicKey;
  userCoinVault: PublicKey;
  userPcVault: PublicKey;
  userLpVault: PublicKey;
  ammConfigId: PublicKey;
  feeDestinationId: PublicKey;

  nonce: number;
  openTime: BN;
  coinAmount: BN;
  pcAmount: BN;
}): InstructionReturn {
  const dataLayout = struct([u8("instruction"), u8("nonce"), u64("openTime"), u64("pcAmount"), u64("coinAmount")]);

  const keys = [
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ammId, isSigner: false, isWritable: true },
    { pubkey: ammAuthority, isSigner: false, isWritable: false },
    { pubkey: ammOpenOrders, isSigner: false, isWritable: true },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: coinMint, isSigner: false, isWritable: false },
    { pubkey: pcMint, isSigner: false, isWritable: false },
    { pubkey: coinVault, isSigner: false, isWritable: true },
    { pubkey: pcVault, isSigner: false, isWritable: true }, //12
    { pubkey: ammTargetOrders, isSigner: false, isWritable: true }, //13
    { pubkey: ammConfigId, isSigner: false, isWritable: false },
    { pubkey: feeDestinationId, isSigner: false, isWritable: true },
    { pubkey: marketProgramId, isSigner: false, isWritable: false },
    { pubkey: marketId, isSigner: false, isWritable: false },
    { pubkey: userWallet, isSigner: true, isWritable: true },
    { pubkey: userCoinVault, isSigner: false, isWritable: true },
    { pubkey: userPcVault, isSigner: false, isWritable: true },
    { pubkey: userLpVault, isSigner: false, isWritable: true },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({ instruction: 1, nonce, openTime, coinAmount, pcAmount }, data);

  return {
    instruction: new TransactionInstruction({
      keys,
      programId,
      data,
    }),
    instructionType: InstructionType.AmmV4CreatePool,
  };
}

export function simulatePoolInfoInstruction(poolKeys: AmmV4Keys | AmmV5Keys): TransactionInstruction {
  const simulatePoolLayout = struct([u8("instruction"), u8("simulateType")]);
  const data = Buffer.alloc(simulatePoolLayout.span);
  simulatePoolLayout.encode(
    {
      instruction: 12,
      simulateType: 0,
    },
    data,
  );

  const keys = [
    // amm
    accountMeta({ pubkey: new PublicKey(poolKeys.id), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.authority), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.openOrders), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.vault.A), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.vault.B), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.mintLp.address), isWritable: false }),
    // serum
    accountMeta({ pubkey: new PublicKey(poolKeys.marketId), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.marketEventQueue), isWritable: false }),
  ];

  return new TransactionInstruction({
    programId: new PublicKey(poolKeys.programId),
    keys,
    data,
  });
}

export function makeSwapFixedInInstruction(
  { poolKeys: propPoolKeys, userKeys, amountIn, minAmountOut }: SwapFixedInInstructionParamsV4,
  version: number,
): TransactionInstruction {
  const poolKeys = jsonInfo2PoolKeys(propPoolKeys);
  const data = Buffer.alloc(fixedSwapInLayout.span);
  fixedSwapInLayout.encode(
    {
      instruction: 9,
      amountIn: parseBigNumberish(amountIn),
      minAmountOut: parseBigNumberish(minAmountOut),
    },
    data,
  );
  const keys = [
    // amm
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: poolKeys.id }),
    accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
    accountMeta({ pubkey: poolKeys.openOrders }),
  ];

  if (version === 4) keys.push(accountMeta({ pubkey: poolKeys.targetOrders }));
  keys.push(accountMeta({ pubkey: poolKeys.vault.A }), accountMeta({ pubkey: poolKeys.vault.B }));
  if (version === 5) keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));
  keys.push(
    // serum
    accountMeta({ pubkey: poolKeys.marketProgramId, isWritable: false }),
    accountMeta({ pubkey: poolKeys.marketId }),
    accountMeta({ pubkey: poolKeys.marketBids }),
    accountMeta({ pubkey: poolKeys.marketAsks }),
    accountMeta({ pubkey: poolKeys.marketEventQueue }),
    accountMeta({ pubkey: poolKeys.marketBaseVault }),
    accountMeta({ pubkey: poolKeys.marketQuoteVault }),
    accountMeta({ pubkey: poolKeys.marketAuthority, isWritable: false }),
    // user
    accountMeta({ pubkey: userKeys.tokenAccountIn }),
    accountMeta({ pubkey: userKeys.tokenAccountOut }),
    accountMeta({ pubkey: userKeys.owner, isWritable: false, isSigner: true }),
  );

  return new TransactionInstruction({
    programId: poolKeys.programId,
    keys,
    data,
  });
}

export function makeSwapFixedOutInstruction(
  { poolKeys: propPoolKeys, userKeys, maxAmountIn, amountOut }: SwapFixedOutInstructionParamsV4,
  version: number,
): TransactionInstruction {
  const poolKeys = jsonInfo2PoolKeys(propPoolKeys);
  const data = Buffer.alloc(fixedSwapOutLayout.span);
  fixedSwapOutLayout.encode(
    {
      instruction: 11,
      maxAmountIn: parseBigNumberish(maxAmountIn),
      amountOut: parseBigNumberish(amountOut),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    // amm
    accountMeta({ pubkey: poolKeys.id }),
    accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
    accountMeta({ pubkey: poolKeys.openOrders }),
    accountMeta({ pubkey: poolKeys.targetOrders }),
    accountMeta({ pubkey: poolKeys.vault.A }),
    accountMeta({ pubkey: poolKeys.vault.B }),
  ];

  if (version === 5) keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));

  keys.push(
    // serum
    accountMeta({ pubkey: poolKeys.marketProgramId, isWritable: false }),
    accountMeta({ pubkey: poolKeys.marketId }),
    accountMeta({ pubkey: poolKeys.marketBids }),
    accountMeta({ pubkey: poolKeys.marketAsks }),
    accountMeta({ pubkey: poolKeys.marketEventQueue }),
    accountMeta({ pubkey: poolKeys.marketBaseVault }),
    accountMeta({ pubkey: poolKeys.marketQuoteVault }),
    accountMeta({ pubkey: poolKeys.marketAuthority, isWritable: false }),
    accountMeta({ pubkey: userKeys.tokenAccountIn }),
    accountMeta({ pubkey: userKeys.tokenAccountOut }),
    accountMeta({ pubkey: userKeys.owner, isWritable: false, isSigner: true }),
  );

  return new TransactionInstruction({
    programId: poolKeys.programId,
    keys,
    data,
  });
}

export function makeAMMSwapInstruction(params: SwapInstructionParams): TransactionInstruction {
  const { poolKeys, version, userKeys, amountIn, amountOut, fixedSide } = params;
  if (version === 4 || version === 5) {
    const props = { poolKeys, userKeys };
    if (fixedSide === "in") {
      return makeSwapFixedInInstruction(
        {
          ...props,
          amountIn,
          minAmountOut: amountOut,
        },
        version,
      );
    } else if (fixedSide === "out") {
      return makeSwapFixedOutInstruction(
        {
          ...props,
          maxAmountIn: amountIn,
          amountOut,
        },
        version,
      );
    }
    logger.logWithError("invalid params", "params", params);
  }

  logger.logWithError("invalid version", "poolKeys.version", version);
  throw new Error("invalid version");
}

export function makeInitPoolInstructionV4({
  poolKeys: propPoolKeys,
  userKeys,
  startTime,
}: InitPoolInstructionParamsV4): TransactionInstruction {
  const data = Buffer.alloc(initPoolLayout.span);
  initPoolLayout.encode(
    {
      instruction: 0,
      // nonce: poolKeys.nonce, // to do fix
      nonce: 5,
      startTime: parseBigNumberish(startTime),
    },
    data,
  );
  const poolKeys = jsonInfo2PoolKeys(propPoolKeys);

  const keys = [
    // system
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: SystemProgram.programId, isWritable: false }),
    accountMeta({ pubkey: SYSVAR_RENT_PUBKEY, isWritable: false }),
    // amm
    accountMeta({ pubkey: poolKeys.id }),
    accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
    accountMeta({ pubkey: poolKeys.openOrders }),
    accountMeta({ pubkey: poolKeys.mintLp.address }),
    accountMeta({ pubkey: poolKeys.mintA.address, isWritable: false }),
    accountMeta({ pubkey: poolKeys.mintB.address, isWritable: false }),
    accountMeta({ pubkey: poolKeys.vault.A, isWritable: false }),
    accountMeta({ pubkey: poolKeys.vault.B, isWritable: false }),
    accountMeta({ pubkey: poolKeys.id }),
    accountMeta({ pubkey: poolKeys.targetOrders }),
    accountMeta({ pubkey: userKeys.lpTokenAccount }),
    accountMeta({ pubkey: poolKeys.id, isWritable: false }),
    // serum
    accountMeta({ pubkey: poolKeys.marketProgramId, isWritable: false }),
    accountMeta({ pubkey: poolKeys.marketId, isWritable: false }),
    // user
    accountMeta({ pubkey: userKeys.payer, isSigner: true }),
  ];

  return new TransactionInstruction({
    programId: poolKeys.programId,
    keys,
    data,
  });
}

export function makeSimulatePoolInfoInstruction({ poolKeys }: { poolKeys: AmmV4Keys | AmmV5Keys }): {
  instruction: TransactionInstruction;
} {
  const LAYOUT = struct([u8("instruction"), u8("simulateType")]);
  const data = Buffer.alloc(LAYOUT.span);
  LAYOUT.encode(
    {
      instruction: 12,
      simulateType: 0,
    },
    data,
  );

  const keys = [
    // amm
    accountMeta({ pubkey: new PublicKey(poolKeys.id), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.authority), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.openOrders), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.vault.A), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.vault.B), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.mintLp.address), isWritable: false }),
    // serum
    accountMeta({ pubkey: new PublicKey(poolKeys.marketId), isWritable: false }),
    accountMeta({ pubkey: new PublicKey(poolKeys.marketEventQueue), isWritable: false }),
  ];

  return {
    instruction: new TransactionInstruction({
      programId: new PublicKey(poolKeys.programId),
      keys,
      data,
    }),
  };
}
