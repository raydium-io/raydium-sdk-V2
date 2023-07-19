import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionInstruction, SystemProgram, AccountMeta } from "@solana/web3.js";
import BN from "bn.js";

import { AmmV3PoolInfo, AmmV3Instrument, ONE, MIN_SQRT_PRICE_X64, MAX_SQRT_PRICE_X64 } from "../ammV3";
import { InstructionType, jsonInfo2PoolKeys, MEMO_PROGRAM_ID } from "../../common";
import { LiquidityPoolKeysV4 } from "../liquidity";
import { struct, u64, u8 } from "../../marshmallow";
import { LiquidityPoolJsonInfo, makeAMMSwapInstruction } from "../liquidity";

import { PoolType, ComputeAmountOutLayout, ReturnTypeMakeSwapInstruction } from "./type";

export function route1Instruction(
  programId: PublicKey,
  poolKeyA: PoolType,
  poolKeyB: PoolType,

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
    { pubkey: new PublicKey(String(poolKeyA.programId)), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(String(poolKeyA.id)), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(String(poolKeyB.id)), isSigner: false, isWritable: true },

    { pubkey: userSourceToken, isSigner: false, isWritable: true },
    { pubkey: userRouteToken, isSigner: false, isWritable: true },
    { pubkey: userPdaAccount, isSigner: false, isWritable: true },
    { pubkey: ownerWallet, isSigner: true, isWritable: false },
  ];

  if (poolKeyA.version === 6) {
    const poolKey = poolKeyA as AmmV3PoolInfo;
    keys.push(
      ...[
        { pubkey: poolKey.ammConfig.id, isSigner: false, isWritable: false },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        {
          pubkey: poolKey.mintA.mint.equals(inputMint) ? poolKey.mintA.vault : poolKey.mintB.vault,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: poolKey.mintA.mint.equals(inputMint) ? poolKey.mintB.vault : poolKey.mintA.vault,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: poolKey.observationId, isSigner: false, isWritable: true },
        ...tickArrayA!.map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
      ],
    );
  } else if (poolKeyA.version === 5) {
    const poolKey = jsonInfo2PoolKeys(poolKeyA) as LiquidityPoolKeysV4;
    keys.push(
      ...[
        { pubkey: poolKey.authority, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        { pubkey: new PublicKey("CDSr3ssLcRB6XYPJwAfFt18MZvEZp4LjHcvzBVZ45duo"), isSigner: false, isWritable: false },
        { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
        { pubkey: poolKey.baseVault, isSigner: false, isWritable: true },
        { pubkey: poolKey.quoteVault, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
      ],
    );
  } else if (poolKeyA.version === 4) {
    const poolKey = jsonInfo2PoolKeys(poolKeyA) as LiquidityPoolKeysV4;
    keys.push(
      ...[
        { pubkey: poolKey.authority, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketAuthority, isSigner: false, isWritable: false },
        { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
        { pubkey: poolKey.baseVault, isSigner: false, isWritable: true },
        { pubkey: poolKey.quoteVault, isSigner: false, isWritable: true },
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
  poolKeyA: PoolType,
  poolKeyB: PoolType,

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

  if (poolKeyB.version === 6) {
    const poolKey = poolKeyB as AmmV3PoolInfo;
    keys.push(
      ...[
        { pubkey: poolKey.ammConfig.id, isSigner: false, isWritable: false },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        {
          pubkey: poolKey.mintA.mint.equals(routeMint) ? poolKey.mintA.vault : poolKey.mintB.vault,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: poolKey.mintA.mint.equals(routeMint) ? poolKey.mintB.vault : poolKey.mintA.vault,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: poolKey.observationId, isSigner: false, isWritable: true },
        ...tickArrayB!.map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
      ],
    );
  } else if (poolKeyB.version === 5) {
    const poolKey = jsonInfo2PoolKeys(poolKeyB) as LiquidityPoolKeysV4;
    keys.push(
      ...[
        { pubkey: poolKey.authority, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        { pubkey: new PublicKey("CDSr3ssLcRB6XYPJwAfFt18MZvEZp4LjHcvzBVZ45duo"), isSigner: false, isWritable: false },
        { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
        { pubkey: poolKey.baseVault, isSigner: false, isWritable: true },
        { pubkey: poolKey.quoteVault, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
        { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
        { pubkey: poolKey.id, isSigner: false, isWritable: true },
      ],
    );
  } else if (poolKeyB.version === 4) {
    const poolKey = jsonInfo2PoolKeys(poolKeyB) as LiquidityPoolKeysV4;
    keys.push(
      ...[
        { pubkey: poolKey.authority, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
        { pubkey: poolKey.marketAuthority, isSigner: false, isWritable: false },
        { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
        { pubkey: poolKey.baseVault, isSigner: false, isWritable: true },
        { pubkey: poolKey.quoteVault, isSigner: false, isWritable: true },
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
  itemPool: PoolType,
  inMint: string,
  userInAccount: PublicKey,
  userOutAccount: PublicKey,
  remainingAccount: PublicKey[] | undefined,
): AccountMeta[] {
  if (itemPool.version === 4) {
    const poolKey = jsonInfo2PoolKeys(itemPool) as LiquidityPoolKeysV4;

    return [
      { pubkey: poolKey.programId, isSigner: false, isWritable: false },
      { pubkey: userInAccount, isSigner: false, isWritable: true },
      { pubkey: userOutAccount, isSigner: false, isWritable: true },

      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      { pubkey: poolKey.authority, isSigner: false, isWritable: false },
      { pubkey: poolKey.marketProgramId, isSigner: false, isWritable: false },
      { pubkey: poolKey.marketAuthority, isSigner: false, isWritable: false },

      { pubkey: poolKey.openOrders, isSigner: false, isWritable: true },
      { pubkey: poolKey.baseVault, isSigner: false, isWritable: true },
      { pubkey: poolKey.quoteVault, isSigner: false, isWritable: true },
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
    const poolKey = jsonInfo2PoolKeys(itemPool) as LiquidityPoolKeysV4;

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
      { pubkey: poolKey.baseVault, isSigner: false, isWritable: true },
      { pubkey: poolKey.quoteVault, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketId, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketBids, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketAsks, isSigner: false, isWritable: true },
      { pubkey: poolKey.marketEventQueue, isSigner: false, isWritable: true },
      { pubkey: poolKey.id, isSigner: false, isWritable: true },
      { pubkey: poolKey.id, isSigner: false, isWritable: true },
    ];
  } else if (itemPool.version === 6) {
    const pool = itemPool as AmmV3PoolInfo;
    const baseIn = pool.mintA.mint.toString() === inMint;
    return [
      { pubkey: new PublicKey(String(itemPool.programId)), isSigner: false, isWritable: false },
      { pubkey: userInAccount, isSigner: false, isWritable: true },
      { pubkey: userOutAccount, isSigner: false, isWritable: true },
      { pubkey: pool.ammConfig.id, isSigner: false, isWritable: false },
      { pubkey: pool.id, isSigner: false, isWritable: true },
      { pubkey: baseIn ? itemPool.mintA.vault : itemPool.mintB.vault, isSigner: false, isWritable: true },
      { pubkey: baseIn ? itemPool.mintB.vault : itemPool.mintA.vault, isSigner: false, isWritable: true },
      { pubkey: itemPool.observationId, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: baseIn ? itemPool.mintA.mint : itemPool.mintB.mint, isSigner: false, isWritable: false },
      { pubkey: baseIn ? itemPool.mintB.mint : itemPool.mintA.mint, isSigner: false, isWritable: false },
      ...(remainingAccount ?? []).map((i) => ({ pubkey: i, isSigner: false, isWritable: true })),
    ];
  } else {
    throw Error("make swap ins error");
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

  poolKeyA: PoolType,
  poolKeyB: PoolType,

  amountIn: BN,
  amountOut: BN,

  remainingAccounts: (PublicKey[] | undefined)[],
): TransactionInstruction {
  const dataLayout = struct([u8("instruction"), u64("amountIn"), u64("amountOut")]);

  const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: wallet, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  keys.push(...makeInnerInsKey(poolKeyA, inputMint, userSourceToken, userRouteToken, remainingAccounts[0]));

  keys.push(...makeInnerInsKey(poolKeyB, routeMint, userRouteToken, userDestinationToken, remainingAccounts[1]));

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
    if (swapInfo.poolKey[0].version === 6) {
      const _poolKey = swapInfo.poolKey[0] as AmmV3PoolInfo;
      const sqrtPriceLimitX64 = inputMint.equals(_poolKey.mintA.mint)
        ? MIN_SQRT_PRICE_X64.add(ONE)
        : MAX_SQRT_PRICE_X64.sub(ONE);

      return await AmmV3Instrument.makeSwapBaseInInstructions({
        poolInfo: _poolKey,
        ownerInfo: {
          wallet: ownerInfo.wallet,
          tokenAccountA: _poolKey.mintA.mint.equals(inputMint) ? ownerInfo.sourceToken : ownerInfo.destinationToken,
          tokenAccountB: _poolKey.mintA.mint.equals(inputMint) ? ownerInfo.destinationToken : ownerInfo.sourceToken,
        },
        inputMint,
        amountIn: swapInfo.amountIn.amount.raw,
        amountOutMin: swapInfo.minAmountOut.amount.raw.sub(swapInfo.minAmountOut.fee?.raw ?? new BN(0)),
        sqrtPriceLimitX64,
        remainingAccounts: swapInfo.remainingAccounts[0],
      });
    } else {
      const _poolKey = swapInfo.poolKey[0] as LiquidityPoolJsonInfo;
      const poolKeys = jsonInfo2PoolKeys(_poolKey);

      return {
        signers: [],
        instructions: [
          makeAMMSwapInstruction({
            poolKeys,
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
        lookupTableAddress: [poolKeys.lookupTableAccount].filter((i) => !i.equals(PublicKey.default)),
        instructionTypes: [_poolKey.version === 4 ? InstructionType.AmmV4SwapBaseIn : InstructionType.AmmV5SwapBaseIn],
        address: {},
      };
    }
  } else if (swapInfo.routeType === "route") {
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

          poolKey1,
          poolKey2,

          swapInfo.amountIn.amount.raw,
          swapInfo.minAmountOut.amount.raw.sub(swapInfo.minAmountOut.fee?.raw ?? new BN(0)),

          swapInfo.remainingAccounts,
        ),
      ],
      instructionTypes: [InstructionType.RouteSwap],
      lookupTableAddress: [new PublicKey(poolKey1.lookupTableAccount), new PublicKey(poolKey2.lookupTableAccount)],
      address: {},
    };
  } else {
    throw Error("route type error");
  }
}
