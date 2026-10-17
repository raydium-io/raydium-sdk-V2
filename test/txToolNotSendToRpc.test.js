// Run against the built SDK: node --test test/txToolNotSendToRpc.test.js
const assert = require("node:assert/strict");
const { createPublicKey, verify } = require("node:crypto");
const { test } = require("node:test");
const { Keypair, SystemProgram, Transaction } = require("@solana/web3.js");
const { Owner, TxBuilder } = require("../lib");

const keypair = (seed) => Keypair.fromSeed(Buffer.alloc(32, seed));
const owner = keypair(1);
const extra = keypair(2);
const blockhash = keypair(3).publicKey.toBase58();
const refreshedBlockhash = keypair(4).publicKey.toBase58();

function validSignatures(tx) {
  if (tx instanceof Transaction) return tx.verifySignatures();
  const message = tx.message.serialize();
  return tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).every((key, index) =>
    verify(
      null,
      message,
      createPublicKey({
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.toBuffer()]),
        format: "der",
        type: "spki",
      }),
      tx.signatures[index],
    ),
  );
}

function fixture(kind, allowSend = false) {
  const calls = { sends: 0, confirmations: 0, walletBatchSizes: [], updates: 0 };
  const connection = {
    getAccountInfo: async () => null,
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 100 }),
    getMultipleAccountsInfo: async (addresses) => {
      assert.equal(addresses.length, 0);
      return [];
    },
    sendRawTransaction: async (wire) => {
      calls.sends++;
      assert(allowSend, "notSendToRpc must not call sendRawTransaction");
      assert(validSignatures(Transaction.from(wire)));
      return "signature";
    },
    sendTransaction: async (tx, signers) => {
      calls.sends++;
      assert(allowSend, "notSendToRpc must not call sendTransaction");
      if (tx instanceof Transaction) tx.sign(...signers);
      assert(validSignatures(tx));
      return "signature";
    },
    getSignatureStatuses: async () => {
      calls.confirmations++;
      assert(allowSend, "sign-only execution must not confirm transactions");
      return { value: [{ err: null, confirmationStatus: "confirmed" }] };
    },
    onSignature: (_signature, callback) => {
      calls.confirmations++;
      assert(allowSend, "sign-only execution must not subscribe for confirmation");
      setImmediate(() => callback({ err: null }));
      return 1;
    },
    removeSignatureListener: () => {},
    getSignatureStatus: async () => ({ value: { err: null } }),
  };
  const builder = () =>
    new TxBuilder({
      connection,
      feePayer: owner.publicKey,
      cluster: "mainnet",
      owner: new Owner(kind === "keypair" ? owner : owner.publicKey),
      signAllTransactions:
        kind === "wallet"
          ? async (transactions) => {
              calls.walletBatchSizes.push(transactions.length);
              return transactions.map((tx) => {
                if (tx instanceof Transaction) tx.partialSign(owner);
                else tx.sign([owner]);
                return tx;
              });
            }
          : undefined,
    });
  return { builder, calls, connection };
}

const transfer = (from) => SystemProgram.transfer({ fromPubkey: from, toPubkey: keypair(5).publicKey, lamports: 1 });

async function build(name, builder, extraSigner = true) {
  const first = builder();
  first.addInstruction({ instructions: [transfer(owner.publicKey)] });
  if (name === "build") return first.build();
  if (name === "buildV0") return first.buildV0({ recentBlockhash: blockhash });
  const secondIx = transfer(extraSigner ? extra.publicKey : owner.publicKey);
  const signers = extraSigner ? [extra] : [];
  if (name === "buildMultiTx" || name === "buildV0MultiTx") {
    const second = builder();
    second.addInstruction({ instructions: [secondIx], signers });
    return name === "buildMultiTx"
      ? first.buildMultiTx({ extraPreBuildData: [second.build()] })
      : first.buildV0MultiTx({
          extraPreBuildData: [await second.buildV0({ recentBlockhash: blockhash })],
          buildProps: { recentBlockhash: blockhash },
        });
  }
  first.addInstruction({ instructions: [secondIx], signers });
  return name === "sizeCheckBuild"
    ? first.sizeCheckBuild({ splitIns: [secondIx] })
    : first.sizeCheckBuildV0({ insCountLimit: 1 });
}

for (const kind of ["keypair", "wallet"]) {
  for (const name of ["build", "buildV0"]) {
    for (const sendAndConfirm of [false, true]) {
      test(`${name} ${kind}: sign only, sendAndConfirm=${sendAndConfirm}`, async () => {
        const { builder, calls } = fixture(kind);
        const built = await build(name, builder);
        const result = await built.execute({ notSendToRpc: true, sendAndConfirm, recentBlockHash: blockhash });
        assert.equal(result.txId, "");
        assert(validSignatures(result.signedTx));
        assert(result.signedTx.serialize().length > 0);
        assert.equal(calls.sends, 0);
        assert.equal(calls.confirmations, 0);
      });
    }
  }
  for (const name of ["buildMultiTx", "buildV0MultiTx", "sizeCheckBuild", "sizeCheckBuildV0"]) {
    for (const sequentially of [false, true]) {
      test(`${name} ${kind}: sign only, sequentially=${sequentially}`, async () => {
        const { builder, calls } = fixture(kind);
        const built = await build(name, builder);
        assert.equal(built.transactions.length, 2);
        const result = await built.execute({
          notSendToRpc: true,
          sequentially,
          recentBlockHash: refreshedBlockhash,
          onTxUpdate: () => calls.updates++,
        });
        assert.deepEqual(result.txIds, []);
        assert.equal(result.signedTxs.length, 2);
        for (const tx of result.signedTxs) {
          assert(validSignatures(tx), "each returned transaction must retain owner and additional signatures");
          assert.equal(tx instanceof Transaction ? tx.recentBlockhash : tx.message.recentBlockhash, refreshedBlockhash);
          assert(tx.serialize().length > 0);
        }
        assert.equal(calls.sends, 0);
        assert.equal(calls.confirmations, 0);
        assert.equal(calls.updates, 0);
      });
    }
  }
}

for (const name of ["buildMultiTx", "buildV0MultiTx", "sizeCheckBuild", "sizeCheckBuildV0"]) {
  test(`${name}: sign-only wallet resumes without requesting skipped signatures`, async () => {
    const { builder, calls } = fixture("wallet");
    const built = await build(name, builder);
    const result = await built.execute({ notSendToRpc: true, sequentially: true, skipTxCount: 1 });
    assert.equal(result.signedTxs.length, 2);
    assert(validSignatures(result.signedTxs[1]));
    assert.deepEqual(calls.walletBatchSizes, [1]);
    assert.equal(calls.sends, 0);
  });
}

for (const kind of ["keypair", "wallet"]) {
  for (const name of ["buildMultiTx", "buildV0MultiTx", "sizeCheckBuild", "sizeCheckBuildV0"]) {
    const legacy = name === "buildMultiTx" || name === "sizeCheckBuild";
    for (const explicitBlockhash of legacy ? [true, false] : [true]) {
      test(`${name} ${kind}: resume preserves skipped transaction, explicit hash=${explicitBlockhash}`, async () => {
        const { builder, calls, connection } = fixture(kind);
        const built = await build(name, builder);
        const skipped = built.transactions[0];
        if (skipped instanceof Transaction) {
          skipped.recentBlockhash = blockhash;
          skipped.partialSign(owner);
        } else {
          skipped.sign([owner]);
        }
        assert(validSignatures(skipped));
        const originalBytes = Buffer.from(skipped.serialize());
        connection.getLatestBlockhash = async () => ({
          blockhash: refreshedBlockhash,
          lastValidBlockHeight: 101,
        });

        const result = await built.execute({
          notSendToRpc: true,
          sequentially: true,
          skipTxCount: 1,
          ...(explicitBlockhash ? { recentBlockHash: refreshedBlockhash } : {}),
          onTxUpdate: () => calls.updates++,
        });

        assert.deepEqual(result.txIds, []);
        assert.equal(result.signedTxs.length, 2);
        assert(validSignatures(result.signedTxs[0]), "skipped transaction must retain its valid signature");
        assert.deepEqual(
          Buffer.from(result.signedTxs[0].serialize()),
          originalBytes,
          "skipped transaction's message and signatures must remain unchanged",
        );
        const pending = result.signedTxs[1];
        assert(validSignatures(pending));
        assert.equal(
          pending instanceof Transaction ? pending.recentBlockhash : pending.message.recentBlockhash,
          refreshedBlockhash,
        );
        assert.deepEqual(calls.walletBatchSizes, kind === "wallet" ? [1] : []);
        assert.equal(calls.sends, 0);
        assert.equal(calls.confirmations, 0);
        assert.equal(calls.updates, 0);
      });
    }
  }
}

for (const name of ["buildMultiTx", "sizeCheckBuild"]) {
  test(`${name}: sign-only preserves an externally supplied signature`, async () => {
    const { builder, calls } = fixture("keypair");
    const built = await build(name, builder);
    built.transactions[1].recentBlockhash = blockhash;
    built.transactions[1].partialSign(extra);
    const index = built.signers[1].findIndex((signer) => signer.publicKey.equals(extra.publicKey));
    assert(index >= 0);
    built.signers[1].splice(index, 1);
    const result = await built.execute({ notSendToRpc: true, recentBlockHash: blockhash });
    assert(validSignatures(result.signedTxs[1]));
    assert.equal(calls.sends, 0);
  });
}

for (const kind of ["keypair", "wallet"]) {
  for (const name of ["build", "buildV0"]) {
    test(`${name} ${kind}: default execution still sends`, async () => {
      const { builder, calls } = fixture(kind, true);
      const result = await (await build(name, builder)).execute({ recentBlockHash: blockhash });
      assert.equal(result.txId, "signature");
      assert.equal(calls.sends, 1);
      assert(validSignatures(result.signedTx));
    });
  }
}

test("v0 multi default execution still sends both transactions", async () => {
  const { builder, calls } = fixture("keypair", true);
  const result = await (await build("buildV0MultiTx", builder)).execute({ sequentially: false });
  assert.equal(result.txIds.length, 2);
  assert.equal(calls.sends, 2);
});
