import { PublicKey } from "@solana/web3.js";
import { findProgramAddress } from "../../common/txTool/txUtils";
import { getSerumAssociatedAuthority } from "./serum";
import { LiquidityPoolKeys } from "./type";

type AssociatedName =
  | "amm_associated_seed"
  | "lp_mint_associated_seed"
  | "coin_vault_associated_seed"
  | "pc_vault_associated_seed"
  | "lp_mint_associated_seed"
  | "temp_lp_token_associated_seed"
  | "open_order_associated_seed"
  | "target_associated_seed"
  | "withdraw_associated_seed";

interface GetAssociatedParam {
  name: AssociatedName;
  programId: PublicKey;
  marketId: PublicKey;
}

export function getLiquidityAssociatedId({ name, programId, marketId }: GetAssociatedParam): PublicKey {
  const { publicKey } = findProgramAddress(
    [programId.toBuffer(), marketId.toBuffer(), Buffer.from(name, "utf-8")],
    programId,
  );
  return publicKey;
}

export function getLiquidityAssociatedAuthority({ programId }: { programId: PublicKey }): {
  publicKey: PublicKey;
  nonce: number;
} {
  return findProgramAddress([Buffer.from([97, 109, 109, 32, 97, 117, 116, 104, 111, 114, 105, 116, 121])], programId);
}

export function getAssociatedPoolKeys({
  version,
  marketVersion,
  marketId,
  baseMint,
  quoteMint,
  baseDecimals,
  quoteDecimals,
  programId,
  marketProgramId,
}: {
  version: 4 | 5;
  marketVersion: 3;
  marketId: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseDecimals: number;
  quoteDecimals: number;
  programId: PublicKey;
  marketProgramId: PublicKey;
}): LiquidityPoolKeys {
  const id = getLiquidityAssociatedId({ name: "amm_associated_seed", programId, marketId });
  const lpMint = getLiquidityAssociatedId({ name: "lp_mint_associated_seed", programId, marketId });
  const { publicKey: authority, nonce } = getLiquidityAssociatedAuthority({ programId });
  const baseVault = getLiquidityAssociatedId({ name: "coin_vault_associated_seed", programId, marketId });
  const quoteVault = getLiquidityAssociatedId({ name: "pc_vault_associated_seed", programId, marketId });
  const lpVault = getLiquidityAssociatedId({ name: "temp_lp_token_associated_seed", programId, marketId });
  const openOrders = getLiquidityAssociatedId({ name: "open_order_associated_seed", programId, marketId });
  const targetOrders = getLiquidityAssociatedId({ name: "target_associated_seed", programId, marketId });
  const withdrawQueue = getLiquidityAssociatedId({ name: "withdraw_associated_seed", programId, marketId });

  const { publicKey: marketAuthority } = getSerumAssociatedAuthority({
    programId: marketProgramId,
    marketId,
  });

  return {
    // base
    id,
    baseMint,
    quoteMint,
    lpMint,
    baseDecimals,
    quoteDecimals,
    lpDecimals: baseDecimals,
    // version
    version,
    programId,
    // keys
    authority,
    nonce,
    baseVault,
    quoteVault,
    lpVault,
    openOrders,
    targetOrders,
    withdrawQueue,
    // market version
    marketVersion,
    marketProgramId,
    // market keys
    marketId,
    marketAuthority,
    lookupTableAccount: PublicKey.default,
  };
}
