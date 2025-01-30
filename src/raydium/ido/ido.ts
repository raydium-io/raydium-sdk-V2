import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { IdoKeysData, OwnerIdoInfo } from "../../api/type";
import { IDO_ALL_PROGRAM } from "../../common/programId";
import { WSOLMint } from "../../common/pubKey";
import { MakeTxData } from "../../common/txTool/txTool";
import { TxVersion } from "../../common/txTool/txType";
import { jsonInfo2PoolKeys } from "../../common/utility";
import ModuleBase from "../moduleBase";
import { makeClaimInstruction, makeClaimInstructionV4 } from "./instruction";

const PROGRAM_TO_VERSION = {
  [IDO_ALL_PROGRAM.IDO_PROGRAM_ID_V1.toString()]: 1,
  [IDO_ALL_PROGRAM.IDO_PROGRAM_ID_V2.toString()]: 2,
  [IDO_ALL_PROGRAM.IDO_PROGRAM_ID_V3.toString()]: 3,
  [IDO_ALL_PROGRAM.IDO_PROGRAM_ID_V4.toString()]: 4,
};

export default class MarketV2 extends ModuleBase {
  public async claim<T extends TxVersion>({
    ownerInfo,
    idoKeys,
    associatedOnly = true,
    checkCreateATAOwner = false,
    txVersion,
    feePayer,
  }: {
    ownerInfo: OwnerIdoInfo[keyof OwnerIdoInfo] & { userIdoInfo: string };
    idoKeys: IdoKeysData;
    associatedOnly?: boolean;
    checkCreateATAOwner?: boolean;
    txVersion?: T;
    feePayer?: PublicKey;
  }): Promise<MakeTxData> {
    const txBuilder = this.createTxBuilder(feePayer);
    const version = PROGRAM_TO_VERSION[idoKeys.programId];

    if (!version) this.logAndCreateError("invalid version", version);
    const poolConfigKey = jsonInfo2PoolKeys(idoKeys);

    const [hasUnClaimedProject, hasUnClaimedBuy] = [!new BN(ownerInfo.coin).isZero(), !new BN(ownerInfo.pc).isZero()];

    const userProjectUseSolBalance = poolConfigKey.projectInfo.mint.address.equals(WSOLMint);
    const { account: userProjectTokenAccount, instructionParams: userProjectInstructionParams } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: poolConfigKey.projectInfo.mint.programId,
        mint: poolConfigKey.projectInfo.mint.address,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: !userProjectUseSolBalance,
        notUseTokenAccount: userProjectUseSolBalance,
        associatedOnly: userProjectUseSolBalance ? false : associatedOnly,
        checkCreateATAOwner,
      });

    if (!userProjectTokenAccount && hasUnClaimedProject)
      this.logAndCreateError("target token accounts not found", "mint", idoKeys.projectInfo.mint.address);
    hasUnClaimedProject && userProjectInstructionParams && txBuilder.addInstruction(userProjectInstructionParams);

    const buyMintUseSolBalance = poolConfigKey.buyInfo.mint.address.equals(WSOLMint);
    const { account: userBuyTokenAccount, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
      tokenProgram: poolConfigKey.buyInfo.mint.programId,
      mint: poolConfigKey.buyInfo.mint.address,
      owner: this.scope.ownerPubKey,
      createInfo: {
        payer: this.scope.ownerPubKey,
        amount: 0,
      },
      skipCloseAccount: !buyMintUseSolBalance,
      notUseTokenAccount: buyMintUseSolBalance,
      associatedOnly: buyMintUseSolBalance ? false : associatedOnly,
      checkCreateATAOwner,
    });
    if (!userProjectTokenAccount && hasUnClaimedBuy)
      this.logAndCreateError("target token accounts not found", "mint", idoKeys.projectInfo.mint.address);
    hasUnClaimedBuy && instructionParams && txBuilder.addInstruction(instructionParams);

    if (!userProjectTokenAccount || !userBuyTokenAccount)
      this.logAndCreateError(
        "target token accounts not found",
        "mint",
        idoKeys.projectInfo.mint.address,
        idoKeys.buyInfo.mint.address,
      );

    if (version === 3) {
      return txBuilder
        .addInstruction({
          instructions: [
            ...(hasUnClaimedProject
              ? [
                makeClaimInstruction<"3">(
                  { programId: poolConfigKey.programId },
                  {
                    idoId: poolConfigKey.id,
                    authority: poolConfigKey.authority,
                    poolTokenAccount: poolConfigKey.projectInfo.vault,
                    userTokenAccount: userProjectTokenAccount!,
                    userIdoInfo: new PublicKey(ownerInfo.userIdoInfo),
                    userOwner: this.scope.ownerPubKey,
                  },
                ),
              ]
              : []),
            ...(hasUnClaimedBuy
              ? [
                makeClaimInstruction<"3">(
                  { programId: new PublicKey(idoKeys.programId) },
                  {
                    idoId: poolConfigKey.id,
                    authority: poolConfigKey.authority,
                    poolTokenAccount: poolConfigKey.buyInfo.vault,
                    userTokenAccount: userBuyTokenAccount!,
                    userIdoInfo: new PublicKey(ownerInfo.userIdoInfo),
                    userOwner: this.scope.ownerPubKey,
                  },
                ),
              ]
              : []),
          ],
        })
        .versionBuild({ txVersion }) as Promise<MakeTxData>;
    }
    if (version < 3) {
      if (!hasUnClaimedProject && !hasUnClaimedBuy) this.logAndCreateError("no claimable rewards");
      return txBuilder
        .addInstruction({
          instructions: [
            makeClaimInstruction<"">(
              { programId: poolConfigKey.programId },
              {
                idoId: poolConfigKey.id,
                authority: poolConfigKey.authority,
                poolQuoteTokenAccount: poolConfigKey.buyInfo.vault,
                poolBaseTokenAccount: poolConfigKey.projectInfo.vault,
                userQuoteTokenAccount: userBuyTokenAccount!,
                userBaseTokenAccount: userProjectTokenAccount!,
                userIdoInfo: new PublicKey(ownerInfo.userIdoInfo),
                userOwner: this.scope.ownerPubKey,
              },
            ),
          ],
        })
        .versionBuild({ txVersion }) as Promise<MakeTxData>;
    }

    const keys = {
      poolConfig: {
        id: poolConfigKey.id,
        programId: poolConfigKey.programId,
        authority: poolConfigKey.authority,
        baseVault: poolConfigKey.projectInfo.vault,
        quoteVault: poolConfigKey.buyInfo.vault,
        baseToken: idoKeys.projectInfo.mint,
        quoteToken: idoKeys.buyInfo.mint,
      },
      userKeys: {
        baseTokenAccount: userProjectTokenAccount!,
        quoteTokenAccount: userBuyTokenAccount!,
        ledgerAccount: new PublicKey(ownerInfo.userIdoInfo),
        owner: this.scope.ownerPubKey,
      },
    };

    return txBuilder
      .addInstruction({
        instructions: [
          ...(hasUnClaimedProject ? [makeClaimInstructionV4({ ...keys, side: "base" })] : []),
          ...(hasUnClaimedBuy ? [makeClaimInstructionV4({ ...keys, side: "quote" })] : []),
        ],
      })
      .versionBuild({ txVersion }) as Promise<MakeTxData>;
  }
}
