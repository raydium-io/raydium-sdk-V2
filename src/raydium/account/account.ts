import { Commitment, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { BigNumberish, getATAAddress, InstructionType, WSOLMint } from "@/common";
import {
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { AddInstructionParam } from "@/common/txTool/txTool";

import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import {
  closeAccountInstruction,
  createWSolAccountInstructions,
  initTokenAccountInstruction,
  makeTransferInstruction,
} from "./instruction";
import { GetOrCreateTokenAccountParams, HandleTokenAccountParams, TokenAccount, TokenAccountRaw } from "./types";
import { generatePubKey, parseTokenAccountResp } from "./util";

export interface TokenAccountDataProp {
  tokenAccounts?: TokenAccount[];
  tokenAccountRawInfos?: TokenAccountRaw[];
  notSubscribeAccountChange?: boolean;
}
export default class Account extends ModuleBase {
  private _tokenAccounts: TokenAccount[] = [];
  private _tokenAccountRawInfos: TokenAccountRaw[] = [];
  private _accountChangeListenerId?: number;
  private _accountListener: ((data: TokenAccountDataProp) => void)[] = [];
  private _clientOwnedToken = false;
  private _notSubscribeAccountChange = false;
  private _accountFetchTime = 0;

  constructor(params: TokenAccountDataProp & ModuleBaseProps) {
    super(params);
    const { tokenAccounts, tokenAccountRawInfos, notSubscribeAccountChange } = params;
    this._tokenAccounts = tokenAccounts || [];
    this._tokenAccountRawInfos = tokenAccountRawInfos || [];
    this._notSubscribeAccountChange = notSubscribeAccountChange ?? true;
    this._clientOwnedToken = !!(tokenAccounts || tokenAccountRawInfos);
  }

  get tokenAccounts(): TokenAccount[] {
    return this._tokenAccounts;
  }
  get tokenAccountRawInfos(): TokenAccountRaw[] {
    return this._tokenAccountRawInfos;
  }

  set notSubscribeAccountChange(subscribe: boolean) {
    this._notSubscribeAccountChange = subscribe;
  }

  public updateTokenAccount({ tokenAccounts, tokenAccountRawInfos }: TokenAccountDataProp): Account {
    if (tokenAccounts) this._tokenAccounts = tokenAccounts;
    if (tokenAccountRawInfos) this._tokenAccountRawInfos = tokenAccountRawInfos;
    this._accountChangeListenerId && this.scope.connection.removeAccountChangeListener(this._accountChangeListenerId);
    this._accountChangeListenerId = undefined;
    this._clientOwnedToken = true;
    return this;
  }

  public addAccountChangeListener(cbk: (data: TokenAccountDataProp) => void): Account {
    this._accountListener.push(cbk);
    return this;
  }

  public removeAccountChangeListener(cbk: (data: TokenAccountDataProp) => void): Account {
    this._accountListener = this._accountListener.filter((listener) => listener !== cbk);
    return this;
  }

  public getAssociatedTokenAccount(mint: PublicKey, programId?: PublicKey): PublicKey {
    return getATAAddress(this.scope.ownerPubKey, mint, programId).publicKey;
  }

  public resetTokenAccounts(): void {
    if (this._clientOwnedToken) return;
    this._tokenAccounts = [];
    this._tokenAccountRawInfos = [];
  }

  public async fetchWalletTokenAccounts(config?: { forceUpdate?: boolean; commitment?: Commitment }): Promise<{
    tokenAccounts: TokenAccount[];
    tokenAccountRawInfos: TokenAccountRaw[];
  }> {
    if (
      this._clientOwnedToken ||
      (!config?.forceUpdate &&
        this._tokenAccounts.length &&
        Date.now() - this._accountFetchTime < (this._notSubscribeAccountChange ? 1000 * 5 : 1000 * 60 * 3))
    ) {
      return {
        tokenAccounts: this._tokenAccounts,
        tokenAccountRawInfos: this._tokenAccountRawInfos,
      };
    }
    this.scope.checkOwner();

    const defaultConfig = {};
    const customConfig = { ...defaultConfig, ...config };

    const [solAccountResp, ownerTokenAccountResp, ownerToken2022AccountResp] = await Promise.all([
      this.scope.connection.getAccountInfo(this.scope.ownerPubKey, customConfig.commitment),
      this.scope.connection.getTokenAccountsByOwner(
        this.scope.ownerPubKey,
        { programId: TOKEN_PROGRAM_ID },
        customConfig.commitment,
      ),
      this.scope.connection.getTokenAccountsByOwner(
        this.scope.ownerPubKey,
        { programId: TOKEN_2022_PROGRAM_ID },
        customConfig.commitment,
      ),
    ]);

    const { tokenAccounts, tokenAccountRawInfos } = parseTokenAccountResp({
      owner: this.scope.ownerPubKey,
      solAccountResp,
      tokenAccountResp: {
        context: ownerTokenAccountResp.context,
        value: [...ownerTokenAccountResp.value, ...ownerToken2022AccountResp.value],
      },
    });

    this._tokenAccounts = tokenAccounts;
    this._tokenAccountRawInfos = tokenAccountRawInfos;

    this._accountFetchTime = Date.now();

    if (!this._notSubscribeAccountChange) {
      this._accountChangeListenerId && this.scope.connection.removeAccountChangeListener(this._accountChangeListenerId);
      this._accountChangeListenerId = this.scope.connection.onAccountChange(
        this.scope.ownerPubKey,
        () => {
          this.fetchWalletTokenAccounts({ forceUpdate: true });
          this._accountListener.forEach((cb) =>
            cb({ tokenAccounts: this._tokenAccounts, tokenAccountRawInfos: this._tokenAccountRawInfos }),
          );
        },
        { commitment: config?.commitment },
      );
    }

    return { tokenAccounts, tokenAccountRawInfos };
  }

  public clearAccountChangeCkb(): void {
    if (this._accountChangeListenerId !== undefined)
      this.scope.connection.removeAccountChangeListener(this._accountChangeListenerId);
  }

  // user token account needed, old _selectTokenAccount
  public async getCreatedTokenAccount({
    mint,
    programId = TOKEN_PROGRAM_ID,
    associatedOnly = true,
  }: {
    mint: PublicKey;
    programId?: PublicKey;
    associatedOnly?: boolean;
  }): Promise<PublicKey | undefined> {
    await this.fetchWalletTokenAccounts();
    const tokenAccounts = this._tokenAccounts
      .filter(({ mint: accountMint }) => accountMint?.equals(mint))
      // sort by balance
      .sort((a, b) => (a.amount.lt(b.amount) ? 1 : -1));

    const ata = this.getAssociatedTokenAccount(mint, programId);
    for (const tokenAccount of tokenAccounts) {
      const { publicKey } = tokenAccount;
      if (publicKey) {
        if (!associatedOnly || (associatedOnly && ata.equals(publicKey))) return publicKey;
      }
    }
  }

  // old _selectOrCreateTokenAccount
  public async getOrCreateTokenAccount(params: GetOrCreateTokenAccountParams): Promise<{
    account?: PublicKey;
    instructionParams?: AddInstructionParam;
  }> {
    await this.fetchWalletTokenAccounts();
    const {
      mint,
      createInfo,
      associatedOnly,
      owner,
      notUseTokenAccount = false,
      skipCloseAccount = false,
      checkCreateATAOwner = false,
      assignSeed,
    } = params;
    const tokenProgram = new PublicKey(params.tokenProgram || TOKEN_PROGRAM_ID);
    const ata = this.getAssociatedTokenAccount(mint, new PublicKey(tokenProgram));
    const accounts = (notUseTokenAccount ? [] : this.tokenAccountRawInfos)
      .filter((i) => i.accountInfo.mint.equals(mint) && (!associatedOnly || i.pubkey.equals(ata)))
      .sort((a, b) => (a.accountInfo.amount.lt(b.accountInfo.amount) ? 1 : -1));
    // find token or don't need create
    if (createInfo === undefined || accounts.length > 0) {
      return accounts.length > 0 ? { account: accounts[0].pubkey } : {};
    }

    const newTxInstructions: AddInstructionParam = {
      instructions: [],
      endInstructions: [],
      signers: [],
      instructionTypes: [],
      endInstructionTypes: [],
    };

    if (associatedOnly) {
      const _createATAIns = createAssociatedTokenAccountInstruction(owner, ata, owner, mint, tokenProgram);
      const _ataInTokenAcc = this.tokenAccountRawInfos.find((i) => i.pubkey.equals(ata))
      if (checkCreateATAOwner) {
        const ataInfo = await this.scope.connection.getAccountInfo(ata);
        if (ataInfo === null) {
          newTxInstructions.instructions?.push(_createATAIns);
          newTxInstructions.instructionTypes!.push(InstructionType.CreateATA);
        } else if (
          ataInfo.owner.equals(tokenProgram) &&
          AccountLayout.decode(ataInfo.data).mint.equals(mint) &&
          AccountLayout.decode(ataInfo.data).owner.equals(owner)
        ) {
          /* empty */
        } else {
          throw Error(`create ata check error -> mint: ${mint.toString()}, ata: ${ata.toString()}`);
        }
      } else if (_ataInTokenAcc === undefined) {
        newTxInstructions.instructions!.push(_createATAIns);
        newTxInstructions.instructionTypes!.push(InstructionType.CreateATA);
      }
      if (mint.equals(WSOLMint) && createInfo.amount) {
        const txInstruction = await createWSolAccountInstructions({
          connection: this.scope.connection,
          owner: this.scope.ownerPubKey,
          payer: createInfo.payer || this.scope.ownerPubKey,
          amount: createInfo.amount ?? 0,
          skipCloseAccount,
        });
        newTxInstructions.instructions!.push(...(txInstruction.instructions || []));
        newTxInstructions.endInstructions!.push(...(txInstruction.endInstructions || []));
        newTxInstructions.instructionTypes!.push(...(txInstruction.instructionTypes || []));
        newTxInstructions.endInstructionTypes!.push(...(txInstruction.endInstructionTypes || []));

        if (createInfo.amount) {
          newTxInstructions.instructions!.push(
            makeTransferInstruction({
              source: txInstruction.addresses.newAccount,
              destination: ata,
              owner: this.scope.ownerPubKey,
              amount: createInfo.amount,
              tokenProgram: TOKEN_PROGRAM_ID,
            }),
          );
          newTxInstructions.instructionTypes!.push(InstructionType.TransferAmount);
        }
      }

      if (!skipCloseAccount && _ataInTokenAcc === undefined) {
        newTxInstructions.endInstructions!.push(
          closeAccountInstruction({
            owner,
            payer: createInfo.payer || owner,
            tokenAccount: ata,
            programId: tokenProgram,
          }),
        );
        newTxInstructions.endInstructionTypes!.push(InstructionType.CloseAccount);
      }

      return { account: ata, instructionParams: newTxInstructions };
    } else {
      const newTokenAccount = generatePubKey({ fromPublicKey: owner, programId: tokenProgram, assignSeed });
      const balanceNeeded = await this.scope.connection.getMinimumBalanceForRentExemption(AccountLayout.span);

      const createAccountIns = SystemProgram.createAccountWithSeed({
        fromPubkey: owner,
        basePubkey: owner,
        seed: newTokenAccount.seed,
        newAccountPubkey: newTokenAccount.publicKey,
        lamports: balanceNeeded + Number(createInfo.amount?.toString() ?? 0),
        space: AccountLayout.span,
        programId: tokenProgram,
      });

      newTxInstructions.instructions!.push(
        createAccountIns,
        initTokenAccountInstruction({
          mint,
          tokenAccount: newTokenAccount.publicKey,
          owner: this.scope.ownerPubKey,
          programId: tokenProgram,
        }),
      );
      newTxInstructions.instructionTypes!.push(InstructionType.CreateAccount);
      newTxInstructions.instructionTypes!.push(InstructionType.InitAccount);
      if (!skipCloseAccount) {
        newTxInstructions.endInstructions!.push(
          closeAccountInstruction({
            owner,
            payer: createInfo.payer || owner,
            tokenAccount: newTokenAccount.publicKey,
            programId: tokenProgram,
          }),
        );
        newTxInstructions.endInstructionTypes!.push(InstructionType.CloseAccount);
      }
      return { account: newTokenAccount.publicKey, instructionParams: newTxInstructions };
    }
    // }
  }

  public async checkOrCreateAta({
    mint,
    programId = TOKEN_PROGRAM_ID,
    autoUnwrapWSOLToSOL,
  }: {
    mint: PublicKey;
    programId?: PublicKey;
    autoUnwrapWSOLToSOL?: boolean;
  }): Promise<{ pubKey: PublicKey; newInstructions: AddInstructionParam }> {
    await this.fetchWalletTokenAccounts();
    let tokenAccountAddress = this.scope.account.tokenAccounts.find(
      ({ mint: accountTokenMint }) => accountTokenMint?.toBase58() === mint.toBase58(),
    )?.publicKey;

    const owner = this.scope.ownerPubKey;
    const newTxInstructions: AddInstructionParam = {};

    if (!tokenAccountAddress) {
      const ataAddress = this.getAssociatedTokenAccount(mint, programId);
      const instruction = await createAssociatedTokenAccountInstruction(owner, ataAddress, owner, mint, programId);
      newTxInstructions.instructions = [instruction];
      newTxInstructions.instructionTypes = [InstructionType.CreateATA];
      tokenAccountAddress = ataAddress;
    }
    if (autoUnwrapWSOLToSOL && WSOLMint.toBase58() === mint.toBase58()) {
      newTxInstructions.endInstructions = [
        closeAccountInstruction({ owner, payer: owner, tokenAccount: tokenAccountAddress, programId }),
      ];
      newTxInstructions.endInstructionTypes = [InstructionType.CloseAccount];
    }

    return {
      pubKey: tokenAccountAddress,
      newInstructions: newTxInstructions,
    };
  }

  // old _handleTokenAccount
  public async handleTokenAccount(
    params: HandleTokenAccountParams,
  ): Promise<AddInstructionParam & { tokenAccount: PublicKey }> {
    const {
      side,
      amount,
      mint,
      programId = TOKEN_PROGRAM_ID,
      tokenAccount,
      payer = this.scope.ownerPubKey,
      bypassAssociatedCheck,
      skipCloseAccount,
      checkCreateATAOwner,
    } = params;

    const ata = this.getAssociatedTokenAccount(mint, programId);

    if (new PublicKey(WSOLMint).equals(mint)) {
      const txInstruction = await createWSolAccountInstructions({
        connection: this.scope.connection,
        owner: this.scope.ownerPubKey,
        payer,
        amount,
        skipCloseAccount,
      });
      return { tokenAccount: txInstruction.addresses.newAccount, ...txInstruction };
    } else if (!tokenAccount || (side === "out" && !ata.equals(tokenAccount) && !bypassAssociatedCheck)) {
      const instructions: TransactionInstruction[] = [];
      const _createATAIns = createAssociatedTokenAccountInstruction(
        this.scope.ownerPubKey,
        ata,
        this.scope.ownerPubKey,
        mint,
        programId,
      );

      if (checkCreateATAOwner) {
        const ataInfo = await this.scope.connection.getAccountInfo(ata);
        if (ataInfo === null) {
          instructions.push(_createATAIns);
        } else if (
          ataInfo.owner.equals(TOKEN_PROGRAM_ID) &&
          AccountLayout.decode(ataInfo.data).mint.equals(mint) &&
          AccountLayout.decode(ataInfo.data).owner.equals(this.scope.ownerPubKey)
        ) {
          /* empty */
        } else {
          throw Error(`create ata check error -> mint: ${mint.toString()}, ata: ${ata.toString()}`);
        }
      } else {
        instructions.push(_createATAIns);
      }

      return {
        tokenAccount: ata,
        instructions,
        instructionTypes: [InstructionType.CreateATA],
      };
    }

    return { tokenAccount };
  }

  public async processTokenAccount(props: {
    mint: PublicKey;
    programId?: PublicKey;
    amount?: BigNumberish;
    useSOLBalance?: boolean;
    handleTokenAccount?: boolean;
    feePayer?: PublicKey;
  }): Promise<Promise<AddInstructionParam & { tokenAccount?: PublicKey }>> {
    const { mint, programId = TOKEN_PROGRAM_ID, amount, useSOLBalance, handleTokenAccount, feePayer } = props;
    let tokenAccount: PublicKey | undefined;
    const txBuilder = this.createTxBuilder(feePayer);

    if (mint.equals(new PublicKey(WSOLMint)) && useSOLBalance) {
      // mintA
      const { tokenAccount: _tokenAccount, ...instructions } = await this.handleTokenAccount({
        side: "in",
        amount: amount || 0,
        mint,
        bypassAssociatedCheck: true,
        programId,
      });
      tokenAccount = _tokenAccount;
      txBuilder.addInstruction(instructions);
    } else {
      tokenAccount = await this.getCreatedTokenAccount({
        mint,
        associatedOnly: false,
        programId,
      });
      if (!tokenAccount && handleTokenAccount) {
        const { tokenAccount: _tokenAccount, ...instructions } = await this.scope.account.handleTokenAccount({
          side: "in",
          amount: 0,
          mint,
          bypassAssociatedCheck: true,
          programId,
        });
        tokenAccount = _tokenAccount;
        txBuilder.addInstruction(instructions);
      }
    }

    return { tokenAccount, ...txBuilder.AllTxData };
  }
}
