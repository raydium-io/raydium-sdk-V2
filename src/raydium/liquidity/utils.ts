import { Connection, PublicKey } from "@solana/web3.js";
import { AmmV4Keys, AmmV5Keys } from "@/api/type";
import {
  findProgramAddress,
  simulateMultipleInstruction,
  parseSimulateLogToJson,
  parseSimulateValue,
} from "@/common/txTool/txUtils";
import { getSerumAssociatedAuthority } from "./serum";
import { LiquidityPoolKeys } from "./type";
import { StableLayout } from "./stable";
import { makeSimulatePoolInfoInstruction } from "./instruction";
import BN from "bn.js";

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

export function getAssociatedConfigId({ programId }: { programId: PublicKey }): PublicKey {
  const { publicKey } = findProgramAddress([Buffer.from("amm_config_account_seed", "utf-8")], programId);
  return publicKey;
}

export function getLiquidityAssociatedId({ name, programId, marketId }: GetAssociatedParam): PublicKey {
  const { publicKey } = findProgramAddress(
    [programId.toBuffer(), marketId.toBuffer(), Buffer.from(name, "utf-8")],
    programId,
  );
  return publicKey;
}

export function getAssociatedOpenOrders({ programId, marketId }: { programId: PublicKey; marketId: PublicKey }) {
  const { publicKey } = findProgramAddress(
    [programId.toBuffer(), marketId.toBuffer(), Buffer.from("open_order_associated_seed", "utf-8")],
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
  const openOrders = getAssociatedOpenOrders({ programId, marketId });
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
    configId: getAssociatedConfigId({ programId }),
  };
}

let stableLayout: StableLayout | undefined;

export async function fetchMultipleInfo({
  connection,
  poolKeysList,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config,
}: {
  connection: Connection;
  poolKeysList: (AmmV4Keys | AmmV5Keys)[];
  config: any;
}): Promise<
  {
    status: BN;
    baseDecimals: number;
    quoteDecimals: number;
    lpDecimals: number;
    baseReserve: BN;
    quoteReserve: BN;
    lpSupply: BN;
    startTime: BN;
  }[]
> {
  if (!stableLayout) {
    stableLayout = new StableLayout({ connection });
    await stableLayout.initStableModelLayout();
  }

  const instructions = poolKeysList.map((pool) => makeSimulatePoolInfoInstruction({ poolKeys: pool }));
  const logs = await simulateMultipleInstruction(
    connection,
    instructions.map((i) => i.instruction),
    "GetPoolData",
  );

  const poolsInfo = logs.map((log) => {
    const json = parseSimulateLogToJson(log, "GetPoolData");

    const status = new BN(parseSimulateValue(json, "status"));
    const baseDecimals = Number(parseSimulateValue(json, "coin_decimals"));
    const quoteDecimals = Number(parseSimulateValue(json, "pc_decimals"));
    const lpDecimals = Number(parseSimulateValue(json, "lp_decimals"));
    const baseReserve = new BN(parseSimulateValue(json, "pool_coin_amount"));
    const quoteReserve = new BN(parseSimulateValue(json, "pool_pc_amount"));
    const lpSupply = new BN(parseSimulateValue(json, "pool_lp_supply"));
    // TODO fix it when split stable
    let startTime = "0";
    try {
      startTime = parseSimulateValue(json, "pool_open_time");
    } catch (error) {
      //
    }

    return {
      status,
      baseDecimals,
      quoteDecimals,
      lpDecimals,
      baseReserve,
      quoteReserve,
      lpSupply,
      startTime: new BN(startTime),
    };
  });

  return poolsInfo;
}
