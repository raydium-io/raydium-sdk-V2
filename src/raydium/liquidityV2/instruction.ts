import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { parseBigNumberish } from "../../common/bignumber";
// import { createLogger } from "../../common/logger";
import { accountMeta } from "../../common/pubKey";

import { addLiquidityLayout } from "./layout";
import { MODEL_DATA_PUBKEY } from "./stable";
import { LiquidityAddInstructionParams } from "./type";

// const logger = createLogger("Raydium_liquidity_instruction");
export function makeAddLiquidityInstruction(params: LiquidityAddInstructionParams): TransactionInstruction {
  const { poolInfo, userKeys, baseAmountIn, quoteAmountIn, fixedSide } = params;

  const data = Buffer.alloc(addLiquidityLayout.span);
  addLiquidityLayout.encode(
    {
      instruction: 3,
      baseAmountIn: parseBigNumberish(baseAmountIn),
      quoteAmountIn: parseBigNumberish(quoteAmountIn),
      fixedSide: parseBigNumberish(fixedSide === "base" ? 0 : 1),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    // amm
    accountMeta({ pubkey: new PublicKey(poolInfo.id) }),
    // accountMeta({ pubkey: poolInfo.authority, isWritable: false }),
    // accountMeta({ pubkey: poolInfo.openOrders, isWritable: false }),
    // accountMeta({ pubkey: poolInfo.targetOrders }),
    accountMeta({ pubkey: new PublicKey(poolInfo.lpMint) }),
    // accountMeta({ pubkey: poolInfo.baseVault }),
    // accountMeta({ pubkey: poolInfo.quoteVault }),
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
    // accountMeta({ pubkey: poolInfo.marketEventQueue, isWritable: false }),
  );

  return new TransactionInstruction({
    programId: new PublicKey(poolInfo.programId),
    keys,
    data,
  });
}
