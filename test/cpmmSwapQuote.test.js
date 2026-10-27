// Run against the built SDK: node --test test/cpmmSwapQuote.test.js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const BN = require("bn.js");
const {
  Connection,
  Keypair,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionMessage,
} = require("@solana/web3.js");
const { NATIVE_MINT, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const { CurveCalculator, Raydium, TxVersion } = require("../lib");

const key = (seed) => Keypair.fromSeed(Buffer.alloc(32, seed)).publicKey;
const owner = Keypair.fromSeed(Buffer.alloc(32, 99));
const rent = 2039280;
const snapshot = (quote) => Object.fromEntries(Object.entries(quote).map(([k, v]) => [k, v.toString()]));

async function fixture(baseIn, nativeInput = false) {
  let mints = [key(1), key(2)].sort((a, b) => a.toBuffer().compare(b.toBuffer()));
  if (nativeInput) {
    const other = Array.from({ length: 200 }, (_, i) => key(i + 1)).find((p) =>
      baseIn ? p.toBuffer().compare(NATIVE_MINT.toBuffer()) > 0 : p.toBuffer().compare(NATIVE_MINT.toBuffer()) < 0,
    );
    mints = baseIn ? [NATIVE_MINT, other] : [other, NATIVE_MINT];
  }
  const [mintA, mintB] = mints.map((mint) => ({
    address: mint.toBase58(),
    decimals: mint.equals(NATIVE_MINT) ? 9 : 6,
    programId: TOKEN_PROGRAM_ID.toBase58(),
  }));
  const poolInfo = { id: key(3).toBase58(), programId: key(4).toBase58(), mintA, mintB };
  const poolKeys = {
    ...poolInfo,
    authority: key(5).toBase58(),
    config: { id: key(6).toBase58() },
    vault: { A: key(7).toBase58(), B: key(8).toBase58() },
  };
  const connection = new Connection("http://127.0.0.1:19999");
  connection.getAccountInfo = async () => null;
  connection.getMinimumBalanceForRentExemption = async () => rent;
  connection.getLatestBlockhash = async () => ({ blockhash: key(9).toBase58(), lastValidBlockHeight: 100 });
  connection.getMultipleAccountsInfo = async (addresses) => {
    assert.equal(addresses.length, 0, "test must not fetch live accounts");
    return [];
  };
  const sdk = await Raydium.load({
    connection,
    owner,
    disableLoadToken: true,
    disableFeatureCheck: true,
    tokenAccounts: [],
    tokenAccountRawInfos: [],
  });
  sdk.account.updateTokenAccount({
    tokenAccounts: [],
    tokenAccountRawInfos: mints.map((mint) => ({
      pubkey: sdk.account.getAssociatedTokenAccount(mint, TOKEN_PROGRAM_ID),
      programId: TOKEN_PROGRAM_ID,
      accountInfo: { mint, owner: owner.publicKey, amount: new BN(10000000) },
    })),
  });
  return { sdk, poolInfo, poolKeys };
}

function quote(fixedOut) {
  return CurveCalculator[fixedOut ? "swapBaseOutput" : "swapBaseInput"](
    new BN(1000000),
    new BN(1000000000),
    new BN(2000000000),
    new BN(2500),
    new BN(0),
    new BN(0),
    new BN(0),
    true,
  );
}

function instructions(built) {
  return built.transaction instanceof Transaction
    ? built.transaction.instructions
    : TransactionMessage.decompile(built.transaction.message).instructions;
}

for (const txVersion of [TxVersion.LEGACY, TxVersion.V0]) {
  for (const baseIn of [true, false]) {
    for (const fixedOut of [false, true]) {
      test(`quote reuse: version=${txVersion}, baseIn=${baseIn}, fixedOut=${fixedOut}`, async () => {
        const { sdk, poolInfo, poolKeys } = await fixture(baseIn);
        const swapResult = quote(fixedOut);
        const before = snapshot(swapResult);
        const params = {
          poolInfo,
          poolKeys,
          baseIn,
          fixedOut,
          inputAmount: swapResult.inputAmount,
          swapResult,
          slippage: 0.01,
          txVersion,
        };
        const first = await sdk.cpmm.swap(params);
        const second = await sdk.cpmm.swap(params);
        assert.deepEqual(snapshot(swapResult), before, "building a transaction must preserve its quote");
        const firstIx = instructions(first).find((ix) => ix.programId.toBase58() === poolInfo.programId);
        const secondIx = instructions(second).find((ix) => ix.programId.toBase58() === poolInfo.programId);
        assert.deepEqual(firstIx.data, secondIx.data, "reusing the quote must preserve swap limits");
        assert.equal(
          firstIx.data.readBigUInt64LE(8),
          fixedOut ? (BigInt(before.inputAmount) * 101n) / 100n : BigInt(before.inputAmount),
        );
        assert.equal(
          firstIx.data.readBigUInt64LE(16),
          fixedOut ? BigInt(before.outputAmount) : (BigInt(before.outputAmount) * 99n) / 100n,
        );
      });
    }
    test(`exact-out native SOL funds the input maximum: version=${txVersion}, baseIn=${baseIn}`, async () => {
      const { sdk, poolInfo, poolKeys } = await fixture(baseIn, true);
      const swapResult = quote(true);
      const before = snapshot(swapResult);
      const built = await sdk.cpmm.swap({
        poolInfo,
        poolKeys,
        baseIn,
        fixedOut: true,
        inputAmount: swapResult.inputAmount,
        swapResult,
        slippage: 0.01,
        txVersion,
      });
      const ix = instructions(built);
      const swap = ix.find((item) => item.programId.toBase58() === poolInfo.programId);
      const create = ix.find((item) => item.programId.equals(SystemProgram.programId));
      const maxInput = (BigInt(before.inputAmount) * 101n) / 100n;
      assert.equal(swap.data.readBigUInt64LE(8), maxInput);
      assert.equal(BigInt(SystemInstruction.decodeCreateWithSeed(create).lamports), maxInput + BigInt(rent));
      assert.deepEqual(snapshot(swapResult), before);
    });
  }
}

test("a frozen quote is accepted", async () => {
  const { sdk, poolInfo, poolKeys } = await fixture(true);
  const swapResult = Object.freeze(quote(false));
  await sdk.cpmm.swap({
    poolInfo,
    poolKeys,
    baseIn: true,
    inputAmount: swapResult.inputAmount,
    swapResult,
    slippage: 0.01,
    txVersion: TxVersion.LEGACY,
  });
});
