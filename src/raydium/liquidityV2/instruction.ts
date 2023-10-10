import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { parseBigNumberish, BN_ZERO, BN_ONE } from "../../common/bignumber";
// import { createLogger } from "../../common/logger";
import { accountMeta } from "../../common/pubKey";

import { addLiquidityLayout, removeLiquidityLayout } from "./layout";
import { MODEL_DATA_PUBKEY } from "./stable";
import { LiquidityAddInstructionParams, RemoveLiquidityInstruction } from "./type";
import { jsonInfo2PoolKeys } from "../../common/utility";

// const logger = createLogger("Raydium_liquidity_instruction");
export function makeAddLiquidityInstruction(params: LiquidityAddInstructionParams): TransactionInstruction {
  const { poolInfo, poolKeys, userKeys, baseAmountIn, quoteAmountIn, fixedSide } = params;

  const data = Buffer.alloc(addLiquidityLayout.span);
  addLiquidityLayout.encode(
    {
      instruction: 3,
      baseAmountIn: parseBigNumberish(baseAmountIn),
      quoteAmountIn: parseBigNumberish(quoteAmountIn),
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
  const { poolInfo, poolKeys: poolKeyProps, userKeys, amountIn } = params;
  const poolKeys = jsonInfo2PoolKeys(poolKeyProps);

  let version = 4;
  if (poolInfo.pooltype.includes("StablePool")) version = 5;

  if (version === 4 || version === 5) {
    const data = Buffer.alloc(removeLiquidityLayout.span);
    removeLiquidityLayout.encode(
      {
        instruction: 4,
        amountIn: parseBigNumberish(amountIn),
      },
      data,
    );

    const keys = [
      // system
      accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
      // amm
      accountMeta({ pubkey: new PublicKey(poolInfo.id) }),
      accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
      accountMeta({ pubkey: poolKeys.openOrders }),
      accountMeta({ pubkey: poolKeys.targetOrders }),
      accountMeta({ pubkey: new PublicKey(poolInfo.lpMint.address) }),
      accountMeta({ pubkey: poolKeys.vault.A }),
      accountMeta({ pubkey: poolKeys.vault.B }),
    ];

    if (version === 5) {
      keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));
    } else {
      keys.push(accountMeta({ pubkey: poolKeys.withdrawQueue }), accountMeta({ pubkey: poolKeys.vault.Lp }));
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
