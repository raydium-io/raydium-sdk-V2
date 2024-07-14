import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

import {
  ClmmInstrument,
  ONE,
  MIN_SQRT_PRICE_X64,
  MAX_SQRT_PRICE_X64,
  MIN_SQRT_PRICE_X64_ADD_ONE,
  MAX_SQRT_PRICE_X64_SUB_ONE,
  getPdaExBitmapAccount,
} from "../clmm";
import {
  InstructionType,
  jsonInfo2PoolKeys,
  MEMO_PROGRAM_ID,
  MEMO_PROGRAM_ID2,
  LIQUIDITY_POOL_PROGRAM_ID_V5_MODEL,
  accountMeta,
} from "@/common";
import { struct, u64, u8, seq, u128 } from "@/marshmallow";
import { makeAMMSwapInstruction } from "../liquidity/instruction";

import { ApiV3PoolInfoItem, PoolKeys, ClmmKeys, AmmV4Keys, AmmV5Keys, CpmmKeys } from "@/api/type";
import { ComputePoolType, MakeSwapInstructionParam, ReturnTypeMakeSwapInstruction } from "./type";
import { makeSwapCpmmBaseInInInstruction, makeSwapCpmmBaseOutInInstruction } from "@/raydium/cpmm";

export function route1Instruction(
  programId: PublicKey,
  poolInfoA: ApiV3PoolInfoItem,
  poolKeyA: PoolKeys,
  poolKeyB: PoolKeys,

  userSourceToken: PublicKey,
  userRouteToken: PublicKey,
  // userDestinationToken: PublicKey,
  userPdaAccount: PublicKey,
  ownerWallet: PublicKey,

  inputMint: PublicKey,

  amountIn: BN,
  amountOut: BN,

  tickArrayA?: PublicKey[],
  // tickArrayB?: PublicKey[],
): TransactionInstruction {
  const dataLayout = struct([u8("instruction"), u64("amountIn"), u64("amountOut")]);

  const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(poolKeyA.programId), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(poolKeyA.id), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(poolKeyB.id), isSigner: false, isWritable: true },

    { pubkey: userSourceToken, isSigner: false, isWritable: true },
    { pubkey: userRouteToken, isSigner: false, isWritable: true },
    { pubkey: userPdaAccount, isSigner: false, isWritable: true },
    { pubkey: ownerWallet, isSigner: true, isWritable: false },
  ];

  if (poolInfoA.type === "Concentrated") {
    const poolKey = jsonInfo2PoolKeys(poolKeyA as ClmmKeys);
    keys.push(
      ...[
        { pubkey: poolKey.config.id, isSigner: false, isWritable: false },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        {
          pubkey: poolKey.mintA.address.equals(inputMint) ? poolKey.vault.A : poolKey.vault.B,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: poolKey.mintA.address.equals(inputMint) ? poolKey.vault.B : poolKey.vault.A,
          isSigner: false,
          isWritable: true,
        },
        // { pubkey: poolKey.observationId, isSigner: false, isWritable: true }, // to do
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        ...tickArrayA!.map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
      ],
    );
  } else if (poolInfoA.pooltype.includes("StablePool")) {
    const poolKey = jsonInfo2PoolKeys(poolKeyA as AmmV5Keys);
    keys.push(
      ...[
        { pubkey: poolKey.authority, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        { pubkey: new PublicKey("CDSr3ssLcRB6XYPJwAfFt18MZvEZp4LjHcvzBVZ45duo"), isSigner: false, isWritable: false },
        { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
        { pubkey: poolKey.vault.A, isSigner: false, isWritable: true },
        { pubkey: poolKey.vault.B, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
      ],
    );
  } else {
    const poolKey = jsonInfo2PoolKeys(poolKeyA as AmmV4Keys);
    keys.push(
      ...[
        { pubkey: poolKey.authority, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketAuthority, isSigner: false, isWritable: false },
        { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
        { pubkey: poolKey.vault.A, isSigner: false, isWritable: true },
        { pubkey: poolKey.vault.B, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
        ...(poolKey.marketProgramId.toString() === "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
          ? [
              { pubkey: poolKey.marketBaseVault, isSigner: false, isWritable: true },
              { pubkey: poolKey.marketQuoteVault, isSigner: false, isWritable: true },
            ]
          : [
              { pubkey: poolKey.id, isSigner: false, isWritable: true },
              { pubkey: poolKey.id, isSigner: false, isWritable: true },
            ]),
      ],
    );
  }

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: 4,
      amountIn,
      amountOut,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

export function route2Instruction(
  programId: PublicKey,
  poolInfoB: ApiV3PoolInfoItem,
  poolKeyA: PoolKeys,
  poolKeyB: PoolKeys,

  // userSourceToken: PublicKey,
  userRouteToken: PublicKey,
  userDestinationToken: PublicKey,
  userPdaAccount: PublicKey,
  ownerWallet: PublicKey,

  routeMint: PublicKey,

  // tickArrayA?: PublicKey[],
  tickArrayB?: PublicKey[],
): TransactionInstruction {
  const dataLayout = struct([u8("instruction")]);

  const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(String(poolKeyB.programId)), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(String(poolKeyB.id)), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(String(poolKeyA.id)), isSigner: false, isWritable: true },

    { pubkey: userRouteToken, isSigner: false, isWritable: true },
    { pubkey: userDestinationToken, isSigner: false, isWritable: true },
    { pubkey: userPdaAccount, isSigner: false, isWritable: true },
    { pubkey: ownerWallet, isSigner: true, isWritable: false },
  ];

  if (poolInfoB.type === "Concentrated") {
    const poolKey = jsonInfo2PoolKeys(poolKeyB as ClmmKeys);
    keys.push(
      ...[
        { pubkey: poolKey.config.id, isSigner: false, isWritable: false },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        {
          pubkey: poolKey.mintA.address.equals(routeMint) ? poolKey.vault.A : poolKey.vault.B,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: poolKey.mintA.address.equals(routeMint) ? poolKey.vault.B : poolKey.vault.A,
          isSigner: false,
          isWritable: true,
        },
        // { pubkey: poolKey.observationId, isSigner: false, isWritable: true }, // to do
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        ...tickArrayB!.map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
      ],
    );
  } else if (poolInfoB.pooltype.includes("StablePool")) {
    const poolKey = jsonInfo2PoolKeys(poolKeyB as AmmV5Keys);
    keys.push(
      ...[
        { pubkey: poolKey.authority, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        { pubkey: new PublicKey("CDSr3ssLcRB6XYPJwAfFt18MZvEZp4LjHcvzBVZ45duo"), isSigner: false, isWritable: false },
        { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
        { pubkey: poolKey.vault.A, isSigner: false, isWritable: true },
        { pubkey: poolKey.vault.B, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
      ],
    );
  } else {
    const poolKey = jsonInfo2PoolKeys(poolKeyB as AmmV4Keys);
    keys.push(
      ...[
        { pubkey: poolKey.authority, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketAuthority, isSigner: false, isWritable: false },
        { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
        { pubkey: poolKey.vault.A, isSigner: false, isWritable: true },
        { pubkey: poolKey.vault.B, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
        ...(poolKey.marketProgramId.toString() === "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
          ? [
              { pubkey: poolKey.marketBaseVault, isSigner: false, isWritable: true },
              { pubkey: poolKey.marketQuoteVault, isSigner: false, isWritable: true },
            ]
          : [
              { pubkey: poolKey.id, isSigner: false, isWritable: true },
              { pubkey: poolKey.id, isSigner: false, isWritable: true },
            ]),
      ],
    );
  }

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: 5,
    },
    data,
  );

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

/*
function makeInnerInsKey(
  itemPool: ComputePoolType,
  itemPoolKey: PoolKeys,
  inMint: string,
  userInAccount: PublicKey,
  userOutAccount: PublicKey,
  remainingAccount: PublicKey[] | undefined,
): AccountMeta[] {
  if (itemPool.version === 4) {
    const poolKey = jsonInfo2PoolKeys(itemPoolKey as AmmV4Keys);

    return [
      { pubkey: poolKey.programId, isSigner: false, isWritable: false },
      { pubkey: userInAccount, isSigner: false, isWritable: true },
      { pubkey: userOutAccount, isSigner: false, isWritable: true },

      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      { pubkey: poolKey.authority, isSigner: false, isWritable: false },
      { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
      { pubkey: poolKey.marketAuthority, isSigner: false, isWritable: true },

      { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
      { pubkey: poolKey.vault.A, isSigner: false, isWritable: true },
      { pubkey: poolKey.vault.B, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
      ...(poolKey.marketProgramId.toString() === "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
        ? [
            { pubkey: poolKey.marketBaseVault, isSigner: false, isWritable: true },
            { pubkey: poolKey.marketQuoteVault, isSigner: false, isWritable: true },
          ]
        : [
            { pubkey: poolKey.id, isSigner: false, isWritable: true },
            { pubkey: poolKey.id, isSigner: false, isWritable: true },
          ]),
    ];
  } else if (itemPool.version === 5) {
    const poolKey = jsonInfo2PoolKeys(itemPoolKey as AmmV4Keys);

    return [
      { pubkey: poolKey.programId, isSigner: false, isWritable: false },
      { pubkey: userInAccount, isSigner: false, isWritable: true },
      { pubkey: userOutAccount, isSigner: false, isWritable: true },

      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      { pubkey: poolKey.authority, isSigner: false, isWritable: false },
      { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("CDSr3ssLcRB6XYPJwAfFt18MZvEZp4LjHcvzBVZ45duo"), isSigner: false, isWritable: false },
      { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
      { pubkey: poolKey.vault.A, isSigner: false, isWritable: true },
      { pubkey: poolKey.vault.B, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      { pubkey: poolKey.id, isSigner: false, isWritable: true },
    ];
  } else if (itemPool.version === 6) {
    const pool = itemPool;
    const poolKey = jsonInfo2PoolKeys(itemPoolKey as ClmmKeys);
    const baseIn = pool.mintA.address === inMint;
    return [
      { pubkey: new PublicKey(String(itemPool.programId)), isSigner: false, isWritable: false },
      { pubkey: userInAccount, isSigner: false, isWritable: true },
      { pubkey: userOutAccount, isSigner: false, isWritable: true },
      { pubkey: poolKey.config.id, isSigner: false, isWritable: false },
      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      { pubkey: baseIn ? poolKey.vault.A : poolKey.vault.B, isSigner: false, isWritable: true },
      { pubkey: baseIn ? poolKey.vault.B : poolKey.vault.A, isSigner: false, isWritable: true },
      { pubkey: itemPool.observationId, isSigner: false, isWritable: true },
      ...(poolKey.mintA.programId.equals(TOKEN_2022_PROGRAM_ID) || poolKey.mintB.programId.equals(TOKEN_2022_PROGRAM_ID)
        ? [
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: baseIn ? poolKey.mintA.address : poolKey.mintB.address, isSigner: false, isWritable: false },
            { pubkey: baseIn ? poolKey.mintB.address : poolKey.mintA.address, isSigner: false, isWritable: false },
          ]
        : []),
      ...(remainingAccount ?? []).map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
      {
        pubkey: getPdaExBitmapAccount(new PublicKey(String(itemPool.programId)), new PublicKey(itemPool.id)).publicKey,
        isSigner: false,
        isWritable: true,
      },
    ];
  } else if (itemPool.version === 7) {
    const pool = itemPool;
    const poolKey = jsonInfo2PoolKeys(itemPoolKey as CpmmKeys);
    const baseIn = pool.mintA.address === inMint;
    return [
      { pubkey: new PublicKey(String(itemPool.programId)), isSigner: false, isWritable: false },
      { pubkey: userInAccount, isSigner: false, isWritable: true },
      { pubkey: userOutAccount, isSigner: false, isWritable: true },
      { pubkey: poolKey.config.id, isSigner: false, isWritable: false },
      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      { pubkey: baseIn ? poolKey.vault.A : poolKey.vault.B, isSigner: false, isWritable: true },
      { pubkey: baseIn ? poolKey.vault.B : poolKey.vault.A, isSigner: false, isWritable: true },
      { pubkey: itemPool.observationId, isSigner: false, isWritable: true },
      ...(poolKey.mintA.programId.equals(TOKEN_2022_PROGRAM_ID) || poolKey.mintB.programId.equals(TOKEN_2022_PROGRAM_ID)
        ? [
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: baseIn ? poolKey.mintA.address : poolKey.mintB.address, isSigner: false, isWritable: false },
            { pubkey: baseIn ? poolKey.mintB.address : poolKey.mintA.address, isSigner: false, isWritable: false },
          ]
        : []),
      ...(remainingAccount ?? []).map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
      {
        pubkey: getPdaExBitmapAccount(new PublicKey(String(itemPool.programId)), new PublicKey(itemPool.id)).publicKey,
        isSigner: false,
        isWritable: true,
      },
    ];
  } else {
    throw Error("make swap ins error");
  }
}
*/

export function routeInstruction(
  programId: PublicKey,
  wallet: PublicKey,

  userSourceToken: PublicKey,
  userRouteToken: PublicKey,
  userDestinationToken: PublicKey,

  inputMint: string,
  routeMint: string,
  outputMint: string,

  poolInfoA: ComputePoolType,
  poolInfoB: ComputePoolType,

  poolKeyA: PoolKeys,
  poolKeyB: PoolKeys,

  amountIn: BN,
  amountOut: BN,

  remainingAccounts: (PublicKey[] | undefined)[],
): TransactionInstruction {
  const clmmPriceLimit: BN[] = [];
  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: SystemProgram.programId, isWritable: false }),
    accountMeta({ pubkey: wallet, isSigner: true }),
  ];

  keys.push(accountMeta({ pubkey: userSourceToken }));
  keys.push(accountMeta({ pubkey: userDestinationToken }));

  const poolInfos = [poolInfoA, poolInfoB];
  const poolKeys = [poolKeyA, poolKeyB];
  const routeMints = [inputMint, routeMint, outputMint];

  for (let index = 0; index < poolInfos.length; index++) {
    const _poolInfo = poolInfos[index];
    const inputIsA = routeMints[index] === _poolInfo.mintA.address;
    keys.push(accountMeta({ pubkey: new PublicKey(_poolInfo.programId), isWritable: false }));
    if (index === poolInfos.length - 1) {
      keys.push(accountMeta({ pubkey: userDestinationToken }));
    } else {
      keys.push(accountMeta({ pubkey: userRouteToken }));
    }
    keys.push(accountMeta({ pubkey: new PublicKey(routeMints[index]) }));
    keys.push(accountMeta({ pubkey: new PublicKey(routeMints[index + 1]) }));
    if (_poolInfo.version === 6) {
      const _poolKey = poolKeys[index] as ClmmKeys;

      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.config.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? _poolKey.vault.A : _poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? _poolKey.vault.B : _poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolInfo.observationId) })); //todo
      keys.push(accountMeta({ pubkey: MEMO_PROGRAM_ID2 }));
      keys.push(
        accountMeta({
          pubkey: getPdaExBitmapAccount(new PublicKey(_poolInfo.programId), new PublicKey(_poolInfo.id)).publicKey,
        }),
      );
      clmmPriceLimit.push(clmmPriceLimitX64InsData(_poolInfo.sqrtPriceX64.toString(), inputIsA));
      for (const item of remainingAccounts[index] ?? []) {
        keys.push(accountMeta({ pubkey: new PublicKey(item) }));
      }
    } else if (_poolInfo.version === 5) {
      const _poolKey = poolKeys[index] as AmmV5Keys;
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.authority), isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketProgramId) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketAuthority) }));
      keys.push(accountMeta({ pubkey: LIQUIDITY_POOL_PROGRAM_ID_V5_MODEL, isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.openOrders) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketId) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketBids) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketAsks) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketEventQueue) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketBaseVault) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketQuoteVault) }));
    } else if (_poolInfo.version === 4) {
      const _poolKey = poolKeys[index] as AmmV4Keys;
      const isSupportIdOnly = _poolInfo.status !== 1;
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.authority), isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.marketProgramId) }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.marketAuthority) }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.openOrders) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.marketId) }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.marketBids) }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.marketAsks) }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.marketEventQueue) }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.marketBaseVault) }));
      keys.push(accountMeta({ pubkey: new PublicKey(isSupportIdOnly ? _poolKey.id : _poolKey.marketQuoteVault) }));
    } else if (_poolInfo.version === 7) {
      const _poolKey = poolKeys[index] as CpmmKeys;
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.authority) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.config.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? _poolKey.vault.A : _poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? _poolKey.vault.B : _poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(_poolInfo.observationId) }));
    } else throw Error("pool type error");
  }

  const dataLayout = struct([
    u8("insId"),
    u64("amountIn"),
    u64("amountOut"),
    seq(u128(), clmmPriceLimit.length, "clmmPriceLimit"),
  ]);
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      insId: 0,
      amountIn,
      amountOut,
      clmmPriceLimit,
    },
    data,
  );
  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

function clmmPriceLimitX64InsData(x64Price: string | undefined, inputIsA: boolean): BN {
  if (x64Price) {
    if (inputIsA) {
      const _m = new BN(x64Price).div(new BN(25));
      return _m.gt(MIN_SQRT_PRICE_X64_ADD_ONE) ? _m : MIN_SQRT_PRICE_X64_ADD_ONE;
    } else {
      const _m = new BN(x64Price).mul(new BN(25));
      return _m.lt(MAX_SQRT_PRICE_X64_SUB_ONE) ? _m : MAX_SQRT_PRICE_X64_SUB_ONE;
    }
  } else {
    return inputIsA ? MIN_SQRT_PRICE_X64_ADD_ONE : MAX_SQRT_PRICE_X64_SUB_ONE;
  }
}

export function makeSwapInstruction({
  routeProgram,
  ownerInfo,
  inputMint,
  swapInfo,
}: MakeSwapInstructionParam): ReturnTypeMakeSwapInstruction {
  if (swapInfo.routeType === "amm") {
    if (swapInfo.poolInfo[0].version === 6) {
      const poolKeys = swapInfo.poolKey[0] as ClmmKeys;
      const _poolKey = jsonInfo2PoolKeys(poolKeys);
      const sqrtPriceLimitX64 = inputMint.equals(_poolKey.mintA.address)
        ? MIN_SQRT_PRICE_X64.add(ONE)
        : MAX_SQRT_PRICE_X64.sub(ONE);

      return ClmmInstrument.makeSwapBaseInInstructions({
        poolInfo: poolKeys,
        poolKeys,
        observationId: swapInfo.poolInfo[0].observationId,
        ownerInfo: {
          wallet: ownerInfo.wallet,
          tokenAccountA: _poolKey.mintA.address.equals(inputMint) ? ownerInfo.sourceToken : ownerInfo.destinationToken,
          tokenAccountB: _poolKey.mintA.address.equals(inputMint) ? ownerInfo.destinationToken : ownerInfo.sourceToken,
        },
        inputMint,
        amountIn: swapInfo.amountIn.amount.raw,
        amountOutMin: swapInfo.minAmountOut.amount.raw.sub(swapInfo.minAmountOut.fee?.raw ?? new BN(0)),
        sqrtPriceLimitX64,
        remainingAccounts: swapInfo.remainingAccounts[0] ?? [],
      });
    } else if (swapInfo.poolInfo[0].version === 7) {
      const poolInfo = swapInfo.poolInfo[0];
      const baseIn = inputMint.toString() === swapInfo.poolInfo[0].mintA.address;

      return {
        signers: [],
        instructions: [
          makeSwapCpmmBaseInInInstruction(
            poolInfo.programId,
            ownerInfo.wallet,
            poolInfo.authority,
            poolInfo.configId,
            poolInfo.id,
            ownerInfo.sourceToken!,
            ownerInfo.destinationToken!,
            baseIn ? poolInfo.vaultA : poolInfo.vaultB,
            baseIn ? poolInfo.vaultB : poolInfo.vaultA,
            baseIn ? poolInfo.mintProgramA : poolInfo.mintProgramB,
            baseIn ? poolInfo.mintProgramB : poolInfo.mintProgramA,
            new PublicKey(poolInfo[baseIn ? "mintA" : "mintB"].address),
            new PublicKey(poolInfo[baseIn ? "mintB" : "mintA"].address),
            poolInfo.observationId,

            swapInfo.amountIn.amount.raw,
            swapInfo.minAmountOut.amount.raw,
          ),
        ],
        lookupTableAddress: [],
        instructionTypes: [baseIn ? InstructionType.CpmmSwapBaseIn : InstructionType.CpmmSwapBaseOut],
        address: {},
      };
    } else {
      const _poolKey = swapInfo.poolKey[0] as AmmV4Keys | AmmV5Keys;

      return {
        signers: [],
        instructions: [
          makeAMMSwapInstruction({
            poolKeys: _poolKey,
            version: swapInfo.poolInfo[0].pooltype.includes("StablePool") ? 5 : 4,
            userKeys: {
              tokenAccountIn: ownerInfo.sourceToken,
              tokenAccountOut: ownerInfo.destinationToken,
              owner: ownerInfo.wallet,
            },
            amountIn: swapInfo.amountIn.amount.raw,
            amountOut: swapInfo.minAmountOut.amount.raw.sub(swapInfo.minAmountOut.fee?.raw ?? new BN(0)),
            fixedSide: "in",
          }),
        ],
        lookupTableAddress: _poolKey.lookupTableAccount ? [_poolKey.lookupTableAccount] : [],
        instructionTypes: [
          swapInfo.poolInfo[0].pooltype.includes("StablePool")
            ? InstructionType.AmmV5SwapBaseIn
            : InstructionType.AmmV4SwapBaseIn,
        ],
        address: {},
      };
    }
  } else if (swapInfo.routeType === "route") {
    const poolInfo1 = swapInfo.poolInfo[0];
    const poolInfo2 = swapInfo.poolInfo[1];
    const poolKey1 = swapInfo.poolKey[0];
    const poolKey2 = swapInfo.poolKey[1];

    if (ownerInfo.routeToken === undefined) throw Error("owner route token account check error");

    return {
      signers: [],
      instructions: [
        routeInstruction(
          routeProgram,
          ownerInfo.wallet,
          ownerInfo.sourceToken,
          ownerInfo.routeToken,
          ownerInfo.destinationToken,

          inputMint.toString(),
          swapInfo.middleToken.mint.toString(),
          swapInfo.outputMint.toString(),

          poolInfo1,
          poolInfo2,
          poolKey1,
          poolKey2,

          swapInfo.amountIn.amount.raw,
          swapInfo.minAmountOut.amount.raw.sub(swapInfo.minAmountOut.fee?.raw ?? new BN(0)),

          swapInfo.remainingAccounts,
        ),
      ],
      instructionTypes: [InstructionType.RouteSwap],
      lookupTableAddress: [poolKey1.lookupTableAccount, poolKey2.lookupTableAccount].filter(
        (a) => a !== undefined,
      ) as string[],
      address: {},
    };
  } else {
    throw Error("route type error");
  }
}
