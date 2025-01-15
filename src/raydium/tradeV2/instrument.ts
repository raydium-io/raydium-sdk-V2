import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  InstructionType,
  LIQUIDITY_POOL_PROGRAM_ID_V5_MODEL,
  MEMO_PROGRAM_ID2,
  accountMeta,
  jsonInfo2PoolKeys,
  getATAAddress,
  ALL_PROGRAM_ID,
} from "@/common";
import { seq, struct, u128, u64, u8 } from "../../marshmallow";
import {
  ClmmInstrument,
  MAX_SQRT_PRICE_X64,
  MAX_SQRT_PRICE_X64_SUB_ONE,
  MIN_SQRT_PRICE_X64,
  MIN_SQRT_PRICE_X64_ADD_ONE,
  ONE,
  getPdaExBitmapAccount,
} from "../clmm";
import { makeAMMSwapInstruction } from "../liquidity/instruction";

import { AmmV4Keys, AmmV5Keys, ApiV3PoolInfoItem, ClmmKeys, CpmmKeys, PoolKeys } from "../../api/type";
import { makeSwapCpmmBaseInInstruction } from "../../raydium/cpmm";
import { ComputePoolType, MakeSwapInstructionParam, ReturnTypeMakeSwapInstruction } from "./type";
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
): accountMeta[] {
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
          makeSwapCpmmBaseInInstruction(
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

export interface ApiSwapV1Out {
  id: string;
  success: boolean;
  version: "V0" | "V1";
  openTime?: undefined;
  msg: undefined;
  data: {
    swapType: "BaseIn" | "BaseOut";
    inputMint: string;
    inputAmount: string;
    outputMint: string;
    outputAmount: string;
    otherAmountThreshold: string;
    slippageBps: number;
    priceImpactPct: number;
    routePlan: {
      poolId: string;
      inputMint: string;
      outputMint: string;
      feeMint: string;
      feeRate: number;
      feeAmount: string;
      remainingAccounts?: string[];
      lastPoolPriceX64?: string;
    }[];
  };
}

export function swapBaseInAutoAccount({
  programId,
  wallet,
  amount,
  inputAccount,
  outputAccount,
  routeInfo,
  poolKeys,
}: {
  programId: PublicKey;
  wallet: PublicKey;
  amount: BN;
  inputAccount: PublicKey;
  outputAccount: PublicKey;
  routeInfo: ApiSwapV1Out;
  poolKeys: PoolKeys[];
}): TransactionInstruction {
  if (routeInfo.success === false) throw Error("route info error");
  const clmmPriceLimit: BN[] = [];
  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: SystemProgram.programId, isWritable: false }),
    accountMeta({ pubkey: wallet, isSigner: true }),
  ];
  const cacheAccount: { [mint: string]: PublicKey } = {
    [routeInfo.data.inputMint]: inputAccount,
    [routeInfo.data.outputMint]: outputAccount,
  };
  keys.push(accountMeta({ pubkey: cacheAccount[routeInfo.data.inputMint] }));
  keys.push(accountMeta({ pubkey: cacheAccount[routeInfo.data.outputMint] }));
  for (let index = 0; index < poolKeys.length; index++) {
    const _routeInfo = routeInfo.data.routePlan[index];
    const _poolKey = poolKeys[index];
    const inputIsA = _routeInfo.inputMint === _poolKey.mintA.address;
    keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.programId), isWritable: false }));
    if (index === poolKeys.length - 1) {
      keys.push(accountMeta({ pubkey: cacheAccount[_routeInfo.outputMint] }));
    } else {
      const mint = _routeInfo.outputMint;
      if (cacheAccount[mint] === undefined) {
        const ata = getATAAddress(
          wallet,
          new PublicKey(mint),
          _poolKey.programId === ALL_PROGRAM_ID.CLMM_PROGRAM_ID.toBase58() ||
            _poolKey.programId === ALL_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58()
            ? new PublicKey(inputIsA ? _poolKey.mintB.programId : _poolKey.mintA.programId)
            : TOKEN_PROGRAM_ID,
        ).publicKey;
        cacheAccount[mint] = ata;
      }
      keys.push(accountMeta({ pubkey: cacheAccount[mint] }));
    }
    keys.push(accountMeta({ pubkey: new PublicKey(_routeInfo.inputMint) }));
    keys.push(accountMeta({ pubkey: new PublicKey(_routeInfo.outputMint) }));
    if (_poolKey.programId === ALL_PROGRAM_ID.CLMM_PROGRAM_ID.toBase58()) {
      const poolKey = _poolKey as ClmmKeys;

      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.config.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? poolKey.vault.A : poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? poolKey.vault.B : poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.observationId) }));
      keys.push(accountMeta({ pubkey: MEMO_PROGRAM_ID2, isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.exBitmapAccount) }));
      clmmPriceLimit.push(clmmPriceLimitX64InsData(_routeInfo.lastPoolPriceX64, inputIsA));
      for (const item of _routeInfo.remainingAccounts ?? []) {
        keys.push(accountMeta({ pubkey: new PublicKey(item) }));
      }
    } else if (_poolKey.programId === ALL_PROGRAM_ID.AMM_STABLE.toBase58()) {
      const poolKey = _poolKey as AmmV5Keys;
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.authority), isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.marketProgramId), isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.marketAuthority), isWritable: false }));
      keys.push(accountMeta({ pubkey: LIQUIDITY_POOL_PROGRAM_ID_V5_MODEL, isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.openOrders) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.marketId) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.marketBids) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.marketAsks) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.marketEventQueue) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.marketBaseVault) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.marketQuoteVault) }));
    } else if (_poolKey.programId === ALL_PROGRAM_ID.AMM_V4.toBase58()) {
      const poolKey = _poolKey as AmmV4Keys;
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.authority), isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketProgramId), isWritable: false }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketAuthority), isWritable: false }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.openOrder) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(poolKey.vault.A) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(poolKey.vault.B) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketId) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.bids) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.asks) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.eventQueue) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketVaultA) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketVaultB) }))
    } else if (_poolKey.programId === ALL_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58()) {
      const poolKey = _poolKey as CpmmKeys;
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.authority) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.config.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? poolKey.vault.A : poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? poolKey.vault.B : poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.observationId) }));
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
      amountIn: amount,
      amountOut: new BN(routeInfo.data.otherAmountThreshold),
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

export function swapBaseOutAutoAccount({
  programId,
  wallet,
  inputAccount,
  outputAccount,
  routeInfo,
  poolKeys,
}: {
  programId: PublicKey;
  wallet: PublicKey;
  inputAccount: PublicKey;
  outputAccount: PublicKey;
  routeInfo: ApiSwapV1Out;
  poolKeys: PoolKeys[];
}): TransactionInstruction {
  if (routeInfo.success === false) throw Error("route info error");
  const clmmPriceLimit: BN[] = [];
  const keys = [
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: SystemProgram.programId, isWritable: false }),
    accountMeta({ pubkey: wallet, isSigner: true }),
  ];
  const cacheAccount: { [mint: string]: PublicKey } = {
    [routeInfo.data.inputMint]: inputAccount,
    [routeInfo.data.outputMint]: outputAccount,
  };
  for (let index = poolKeys.length - 1; index >= 0; index--) {
    const _routeInfo = routeInfo.data.routePlan[index];
    const _poolKey = poolKeys[index];
    const inputIsA = _routeInfo.inputMint === _poolKey.mintA.address;
    keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.programId) }));
    if (index === 0) {
      keys.push(accountMeta({ pubkey: cacheAccount[_routeInfo.inputMint] }));
    } else {
      const mint = _routeInfo.inputMint;
      if (cacheAccount[mint] === undefined) {
        const ata = getATAAddress(
          wallet,
          new PublicKey(mint),
          _poolKey.programId === ALL_PROGRAM_ID.CLMM_PROGRAM_ID.toBase58() ||
            _poolKey.programId === ALL_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58()
            ? new PublicKey(inputIsA ? _poolKey.mintA.programId : _poolKey.mintB.programId)
            : TOKEN_PROGRAM_ID,
        ).publicKey;
        cacheAccount[mint] = ata;
      }
      keys.push(accountMeta({ pubkey: cacheAccount[mint] }));
    }
    if (index === poolKeys.length - 1) {
      keys.push(accountMeta({ pubkey: cacheAccount[_routeInfo.outputMint] }));
    } else {
      const mint = _routeInfo.outputMint;
      if (cacheAccount[mint] === undefined) {
        const ata = getATAAddress(
          wallet,
          new PublicKey(mint),
          _poolKey.programId === ALL_PROGRAM_ID.CLMM_PROGRAM_ID.toBase58() ||
            _poolKey.programId === ALL_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58()
            ? new PublicKey(inputIsA ? _poolKey.mintB.programId : _poolKey.mintA.programId)
            : TOKEN_PROGRAM_ID,
        ).publicKey;
        cacheAccount[mint] = ata;
      }
      keys.push(accountMeta({ pubkey: cacheAccount[mint] }));
    }
    keys.push(accountMeta({ pubkey: new PublicKey(_routeInfo.inputMint) }));
    keys.push(accountMeta({ pubkey: new PublicKey(_routeInfo.outputMint) }));
    if (_poolKey.programId === ALL_PROGRAM_ID.CLMM_PROGRAM_ID.toBase58()) {
      const poolKey = _poolKey as ClmmKeys;
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.config.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? poolKey.vault.A : poolKey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? poolKey.vault.B : poolKey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.observationId) }));
      keys.push(accountMeta({ pubkey: MEMO_PROGRAM_ID2, isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolKey.exBitmapAccount) }));
      clmmPriceLimit.push(clmmPriceLimitX64InsData(_routeInfo.lastPoolPriceX64, inputIsA));
      for (const item of _routeInfo.remainingAccounts ?? []) {
        keys.push(accountMeta({ pubkey: new PublicKey(item) }));
      }
    } else if (_poolKey.programId === ALL_PROGRAM_ID.AMM_STABLE.toBase58()) {
      const poolkey = _poolKey as AmmV5Keys;
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.authority), isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.marketProgramId), isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.marketAuthority), isWritable: false }));
      keys.push(accountMeta({ pubkey: LIQUIDITY_POOL_PROGRAM_ID_V5_MODEL, isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.openOrders) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.marketId) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.marketBids) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.marketAsks) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.marketEventQueue) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.marketBaseVault) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.marketQuoteVault) }));
    } else if (_poolKey.programId === ALL_PROGRAM_ID.AMM_V4.toBase58()) {
      const poolkey = _poolKey as AmmV4Keys;
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.authority), isWritable: false }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketProgramId), isWritable: false }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketAuthority), isWritable: false }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.openOrder) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(poolKey.vault.A) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(poolKey.vault.B) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketId) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.bids) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.asks) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.eventQueue) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketVaultA) }))
      // keys.push(accountMeta({ pubkey: new PublicKey(_poolKey.marketVaultB) }))
    } else if (_poolKey.programId === ALL_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58()) {
      const poolkey = _poolKey as CpmmKeys;

      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.authority) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.config.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.id) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? poolkey.vault.A : poolkey.vault.B) }));
      keys.push(accountMeta({ pubkey: new PublicKey(inputIsA ? poolkey.vault.B : poolkey.vault.A) }));
      keys.push(accountMeta({ pubkey: new PublicKey(poolkey.observationId) }));
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
      insId: 1,
      amountIn: new BN(routeInfo.data.otherAmountThreshold),
      amountOut: new BN(routeInfo.data.outputAmount),
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
