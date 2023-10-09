import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { parseBigNumberish, BN_ZERO, BN_ONE } from "../../common/bignumber";
// import { createLogger } from "../../common/logger";
import { accountMeta } from "../../common/pubKey";

import { addLiquidityLayout } from "./layout";
import { MODEL_DATA_PUBKEY } from "./stable";
import { LiquidityAddInstructionParams } from "./type";

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
