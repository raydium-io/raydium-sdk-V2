import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { AmmV4Keys, AmmV5Keys } from "../../api/type";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  findProgramAddress,
  parseSimulateLogToJson,
  parseSimulateValue,
  simulateMultipleInstruction,
} from "@/common/txTool/txUtils";
import { toApiV3Token } from "../../raydium/token/utils";
import { makeSimulatePoolInfoInstruction } from "./instruction";
import { getSerumAssociatedAuthority } from "./serum";
import { StableLayout } from "./stable";
import { AmmRpcData, ComputeAmountOutParam, LiquidityPoolKeys } from "./type";
import { liquidityStateV4Layout } from "./layout";
import { splAccountLayout } from "../account";
import { SPL_MINT_LAYOUT } from "../token";

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
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const loadStable = poolKeysList.find((i) => i.modelDataAccount);
  if (loadStable) {
    if (!stableLayout) {
      stableLayout = new StableLayout({ connection });
      await stableLayout.initStableModelLayout();
    }
  }
  return await Promise.all(
    poolKeysList.map(async (itemPoolKey) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (itemPoolKey.modelDataAccount) {
        const instructions = makeSimulatePoolInfoInstruction({ poolKeys: itemPoolKey });
        const logs = await simulateMultipleInstruction(connection, [instructions.instruction], "GetPoolData");
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
        })[0];
        return poolsInfo;
      } else {
        const [poolAcc, vaultAccA, vaultAccB, mintAccLp] = await connection.getMultipleAccountsInfo([
          new PublicKey(itemPoolKey.id),
          new PublicKey(itemPoolKey.vault.A),
          new PublicKey(itemPoolKey.vault.B),
          new PublicKey(itemPoolKey.mintLp.address),
        ]);
        if (poolAcc === null) throw Error("fetch pool error");
        if (vaultAccA === null) throw Error("fetch vaultAccA error");
        if (vaultAccB === null) throw Error("fetch vaultAccB error");
        if (mintAccLp === null) throw Error("fetch mintAccLp error");
        const poolInfo = liquidityStateV4Layout.decode(poolAcc.data);
        const vaultInfoA = splAccountLayout.decode(vaultAccA.data);
        const vaultInfoB = splAccountLayout.decode(vaultAccB.data);
        const lpInfo = SPL_MINT_LAYOUT.decode(mintAccLp.data);
        return {
          status: poolInfo.status,
          baseDecimals: poolInfo.baseDecimal.toNumber(),
          quoteDecimals: poolInfo.quoteDecimal.toNumber(),
          lpDecimals: lpInfo.decimals,
          baseReserve: vaultInfoA.amount.sub(poolInfo.baseNeedTakePnl),
          quoteReserve: vaultInfoB.amount.sub(poolInfo.quoteNeedTakePnl),
          lpSupply: poolInfo.lpReserve,
          startTime: poolInfo.poolOpenTime,
        };
      }
    }),
  );
}

const mockRewardData = {
  volume: 0,
  volumeQuote: 0,
  volumeFee: 0,
  apr: 0,
  feeApr: 0,
  priceMin: 0,
  priceMax: 0,
  rewardApr: [],
};

export const toAmmComputePoolInfo = (
  poolData: Record<string, AmmRpcData>,
): Record<string, ComputeAmountOutParam["poolInfo"]> => {
  const data: Record<string, ComputeAmountOutParam["poolInfo"]> = {};
  const tokenProgramStr = TOKEN_PROGRAM_ID.toBase58();

  Object.keys(poolData).map((poolId) => {
    const poolInfo = poolData[poolId];
    const [mintA, mintB] = [poolInfo.baseMint.toBase58(), poolInfo.quoteMint.toBase58()];
    data[poolId] = {
      id: poolId,
      version: 4,
      status: poolInfo.status.toNumber(),
      programId: poolInfo.programId.toBase58(), // needed
      mintA: toApiV3Token({
        address: mintA, // needed
        programId: tokenProgramStr,
        decimals: poolInfo.baseDecimal.toNumber(),
      }),
      mintB: toApiV3Token({
        address: mintB, // needed
        programId: tokenProgramStr,
        decimals: poolInfo.quoteDecimal.toNumber(),
      }),
      rewardDefaultInfos: [],
      rewardDefaultPoolInfos: "Ecosystem",
      price: poolInfo.poolPrice.toNumber(),
      mintAmountA: new Decimal(poolInfo.mintAAmount.toString()).div(10 ** poolInfo.baseDecimal.toNumber()).toNumber(),
      mintAmountB: new Decimal(poolInfo.mintBAmount.toString()).div(10 ** poolInfo.quoteDecimal.toNumber()).toNumber(),
      baseReserve: poolInfo.baseReserve, // needed
      quoteReserve: poolInfo.quoteReserve, // needed
      feeRate: new Decimal(poolInfo.tradeFeeNumerator.toString())
        .div(poolInfo.tradeFeeDenominator.toString())
        .toNumber(),
      openTime: poolInfo.poolOpenTime.toString(),
      tvl: 0,
      day: mockRewardData,
      week: mockRewardData,
      month: mockRewardData,
      pooltype: [],
      farmUpcomingCount: 0,
      farmOngoingCount: 0,
      farmFinishedCount: 0,
      type: "Standard",
      marketId: poolInfo.marketId.toBase58(),
      configId: getAssociatedConfigId({ programId: poolInfo.programId }).toBase58(),
      lpPrice: 0,
      lpAmount: new Decimal(poolInfo.lpReserve.toString())
        .div(10 ** Math.min(poolInfo.baseDecimal.toNumber(), poolInfo.quoteDecimal.toNumber()))
        .toNumber(),
      lpMint: toApiV3Token({
        address: poolInfo.lpMint.toBase58(),
        programId: tokenProgramStr,
        decimals: Math.min(poolInfo.baseDecimal.toNumber(), poolInfo.quoteDecimal.toNumber()),
      }),
      burnPercent: 0,
    };
  });
  return data;
};
