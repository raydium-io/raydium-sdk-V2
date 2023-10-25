import { PublicKey } from "@solana/web3.js";
import ModuleBase from "../moduleBase";
import { makeClaimInstruction, makeClaimInstructionV4 } from "./instruction";
import { MakeTransaction } from "../type";
import { jsonInfo2PoolKeys } from "@/common/utility";
import { OwnerIdoInfo, IdoKeysData } from "@/api/type";
import { IDO_ALL_PROGRAM } from "@/common/programId";

const PROGRAM_TO_VERSION = {
  [IDO_ALL_PROGRAM.IDO_PROGRAM_ID_V1.toString()]: 1,
  [IDO_ALL_PROGRAM.IDO_PROGRAM_ID_V2.toString()]: 2,
  [IDO_ALL_PROGRAM.IDO_PROGRAM_ID_V3.toString()]: 3,
  [IDO_ALL_PROGRAM.IDO_PROGRAM_ID_V4.toString()]: 4,
};

export default class MarketV2 extends ModuleBase {
  public async claim({
    ownerInfo,
    idoKeys,
  }: {
    ownerInfo: OwnerIdoInfo[keyof OwnerIdoInfo] & { userIdoInfo: string };
    idoKeys: IdoKeysData;
  }): Promise<MakeTransaction> {
    const txBuilder = this.createTxBuilder();
    const version = PROGRAM_TO_VERSION[idoKeys.programId];

    if (!version) this.logAndCreateError("invalid version", version);
    const poolConfigKey = jsonInfo2PoolKeys(idoKeys);

    const userProjectTokenAccount = await this.scope.account.getCreatedTokenAccount({
      programId: poolConfigKey.projectInfo.mint.programId,
      mint: poolConfigKey.projectInfo.mint.address,
    });
    const userBuyTokenAccount = await this.scope.account.getCreatedTokenAccount({
      programId: poolConfigKey.buyInfo.mint.programId,
      mint: poolConfigKey.buyInfo.mint.address,
    });

    if (!userProjectTokenAccount || !userBuyTokenAccount)
      this.logAndCreateError(
        "target token accounts not found",
        "mint",
        idoKeys.projectInfo.mint.address,
        idoKeys.buyInfo.mint.address,
      );

    if (version < 3) {
      return txBuilder
        .addInstruction({
          instructions: [
            makeClaimInstruction<"">(
              { programId: new PublicKey(idoKeys.programId) },
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
        .build();
    }

    if (version === 3) {
      const claimProjectTokenIns = makeClaimInstruction<"3">(
        { programId: poolConfigKey.programId },
        {
          idoId: poolConfigKey.id,
          authority: poolConfigKey.authority,
          poolTokenAccount: poolConfigKey.projectInfo.vault,
          userTokenAccount: userProjectTokenAccount!,
          userIdoInfo: new PublicKey(ownerInfo.userIdoInfo),
          userOwner: this.scope.ownerPubKey,
        },
      );
      const claimBuyTokenIns = makeClaimInstruction<"3">(
        { programId: new PublicKey(idoKeys.programId) },
        {
          idoId: poolConfigKey.id,
          authority: poolConfigKey.authority,
          poolTokenAccount: poolConfigKey.buyInfo.vault,
          userTokenAccount: userBuyTokenAccount!,
          userIdoInfo: new PublicKey(ownerInfo.userIdoInfo),
          userOwner: this.scope.ownerPubKey,
        },
      );

      return txBuilder.addInstruction({ instructions: [claimProjectTokenIns, claimBuyTokenIns] }).build();
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
    const claimProjectIns = makeClaimInstructionV4({
      ...keys,
      side: "base",
    });
    const claimButIns = makeClaimInstructionV4({
      ...keys,
      side: "quote",
    });

    return txBuilder.addInstruction({ instructions: [claimProjectIns, claimButIns] }).build();
  }
}
