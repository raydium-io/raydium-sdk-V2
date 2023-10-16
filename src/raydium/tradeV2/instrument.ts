import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction, SystemProgram, AccountMeta } from "@solana/web3.js";
import BN from "bn.js";

import { ClmmInstrument, ONE, MIN_SQRT_PRICE_X64, MAX_SQRT_PRICE_X64 } from "../clmm";
import { InstructionType, jsonInfo2PoolKeys, MEMO_PROGRAM_ID } from "../../common";
import { struct, u64, u8 } from "../../marshmallow";
import { makeAMMSwapInstruction } from "../liquidity/instruction";

import {
  ApiV3PoolInfoItem,
  ApiV3PoolInfoConcentratedItem,
  PoolKeys,
  ClmmKeys,
  AmmV4Keys,
  AmmV5Keys,
} from "../../api/type";
import { ComputeAmountOutLayout, ReturnTypeMakeSwapInstruction } from "./type";

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

function makeInnerInsKey(
  itemPool: ApiV3PoolInfoItem,
  itemPoolKey: PoolKeys,
  inMint: string,
  userInAccount: PublicKey,
  userOutAccount: PublicKey,
  remainingAccount: PublicKey[] | undefined,
): AccountMeta[] {
  if (itemPool.pooltype.includes("StablePool")) {
    const poolKey = jsonInfo2PoolKeys(itemPoolKey as AmmV5Keys);

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
  } else if (itemPool.type === "Concentrated") {
    const pool = itemPool as ApiV3PoolInfoConcentratedItem;
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
      // { pubkey: itemPool.observationId, isSigner: false, isWritable: true }, // todo
      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      ...(poolKey.mintA.programId.equals(TOKEN_2022_PROGRAM_ID) || poolKey.mintB.programId.equals(TOKEN_2022_PROGRAM_ID)
        ? [
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: baseIn ? poolKey.mintA.address : poolKey.mintB.address, isSigner: false, isWritable: false },
            { pubkey: baseIn ? poolKey.mintB.address : poolKey.mintA.address, isSigner: false, isWritable: false },
          ]
        : []),
      ...(remainingAccount ?? []).map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
    ];
  } else {
    const poolKey = jsonInfo2PoolKeys(itemPoolKey as AmmV4Keys);

    return [
      { pubkey: poolKey.programId, isSigner: false, isWritable: false },
      { pubkey: userInAccount, isSigner: false, isWritable: true },
      { pubkey: userOutAccount, isSigner: false, isWritable: true },

      { pubkey: poolKey.id, isSigner: false, isWritable: true },
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
    ];
  }
}

export function routeInstruction(
  programId: PublicKey,
  wallet: PublicKey,

  userSourceToken: PublicKey,
  userRouteToken: PublicKey,
  userDestinationToken: PublicKey,

  inputMint: string,
  routeMint: string,

  poolInfoA: ApiV3PoolInfoItem,
  poolInfoB: ApiV3PoolInfoItem,

  poolKeyA: PoolKeys,
  poolKeyB: PoolKeys,

  amountIn: BN,
  amountOut: BN,

  remainingAccounts: (PublicKey[] | undefined)[],
): TransactionInstruction {
  const dataLayout = struct([u8("instruction"), u64("amountIn"), u64("amountOut")]);

  const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: wallet, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  keys.push(...makeInnerInsKey(poolInfoA, poolKeyA, inputMint, userSourceToken, userRouteToken, remainingAccounts[0]));

  keys.push(
    ...makeInnerInsKey(poolInfoB, poolKeyB, routeMint, userRouteToken, userDestinationToken, remainingAccounts[1]),
  );

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: 8,
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

type MakeSwapInstructionParam = {
  ownerInfo: {
    wallet: PublicKey;
    // tokenAccountA: PublicKey
    // tokenAccountB: PublicKey

    sourceToken: PublicKey;
    routeToken?: PublicKey;
    destinationToken: PublicKey;
  };

  inputMint: PublicKey;
  routeProgram: PublicKey;

  swapInfo: ComputeAmountOutLayout;
};

export async function makeSwapInstruction({
  routeProgram,
  ownerInfo,
  inputMint,
  swapInfo,
}: MakeSwapInstructionParam): Promise<ReturnTypeMakeSwapInstruction> {
  if (swapInfo.routeType === "amm") {
    if (swapInfo.poolInfo[0].type === "Concentrated") {
      const _poolKey = jsonInfo2PoolKeys(swapInfo.poolKey[0] as ClmmKeys);
      const sqrtPriceLimitX64 = inputMint.equals(_poolKey.mintA.address)
        ? MIN_SQRT_PRICE_X64.add(ONE)
        : MAX_SQRT_PRICE_X64.sub(ONE);

      return await ClmmInstrument.makeSwapBaseInInstructions({
        poolInfo: _poolKey as any,
        poolKeys: _poolKey as any,
        ownerInfo: {
          wallet: ownerInfo.wallet,
          tokenAccountA: _poolKey.mintA.address.equals(inputMint) ? ownerInfo.sourceToken : ownerInfo.destinationToken,
          tokenAccountB: _poolKey.mintA.address.equals(inputMint) ? ownerInfo.destinationToken : ownerInfo.sourceToken,
        },
        inputMint,
        amountIn: swapInfo.amountIn.amount.raw,
        amountOutMin: swapInfo.minAmountOut.amount.raw.sub(swapInfo.minAmountOut.fee?.raw ?? new BN(0)),
        sqrtPriceLimitX64,
        remainingAccounts: swapInfo.remainingAccounts[0],
      });
    } else {
      const _poolKey = swapInfo.poolKey[0] as AmmV4Keys | AmmV5Keys;
      const poolKeys = jsonInfo2PoolKeys(_poolKey);

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
        lookupTableAddress: (poolKeys.lookupTableAccount ? [new PublicKey(poolKeys.lookupTableAccount)] : []).filter(
          (i) => !i.equals(PublicKey.default),
        ),
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
          swapInfo.minMiddleAmountFee!.token.mint.toString(),

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
      lookupTableAddress: [poolKey1.lookupTableAccount, poolKey2.lookupTableAccount]
        .filter((a) => a !== undefined)
        .map((v) => new PublicKey(v!)),
      address: {},
    };
  } else {
    throw Error("route type error");
  }
}
