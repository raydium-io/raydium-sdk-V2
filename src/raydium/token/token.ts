import { PublicKey } from "@solana/web3.js";
import { MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { ApiV3Token, JupTokenType } from "@/api/type";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { LoadParams } from "../type";

import { SOL_INFO } from "./constant";
import { TokenInfo } from "./type";

export default class TokenModule extends ModuleBase {
  private _tokenList: TokenInfo[] = [];
  private _tokenMap: Map<string, TokenInfo> = new Map();
  private _blackTokenMap: Set<string> = new Set();
  private _mintGroup: { official: Set<string>; jup: Set<string>; extra: Set<string> } = {
    official: new Set(),
    jup: new Set(),
    extra: new Set(),
  };
  private _whiteMap: Set<string> = new Set();
  private _extraTokenList: TokenInfo[] = [];

  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(params?: LoadParams & { type?: JupTokenType }): Promise<void> {
    this.checkDisabled();
    const { forceUpdate = false, type = JupTokenType.Strict } = params || {};
    const { mintList, blacklist, whiteList } = await this.scope.fetchV3TokenList(forceUpdate);
    const jup = await this.scope.fetchJupTokenList(forceUpdate);
    // reset all data
    this._tokenList = [];
    this._tokenMap = new Map();
    this._blackTokenMap = new Set(blacklist);
    this._mintGroup = { official: new Set(), jup: new Set(), extra: new Set() };
    this._whiteMap = new Set(whiteList);

    this._tokenMap.set(SOL_INFO.address, SOL_INFO);
    this._mintGroup.official.add(SOL_INFO.address);

    mintList.forEach((token) => {
      if (this._blackTokenMap.has(token.address)) return;
      this._tokenMap.set(token.address, {
        ...token,
        type: "raydium",
        priority: 2,
        programId:
          token.programId ??
          (token.tags.includes("token-2022") ? TOKEN_2022_PROGRAM_ID.toBase58() : TOKEN_PROGRAM_ID.toBase58()),
      });
      this._mintGroup.official.add(token.address);
    });

    jup.forEach((token) => {
      if (this._blackTokenMap.has(token.address) || this._tokenMap.has(token.address)) return;
      this._tokenMap.set(token.address, {
        ...token,
        type: "jupiter",
        priority: 1,
        programId:
          token.programId ??
          (token.tags.includes("token-2022") ? TOKEN_2022_PROGRAM_ID.toBase58() : TOKEN_PROGRAM_ID.toBase58()),
        tags: token.freezeAuthority ? [...(token.tags || []), "hasFreeze"] : token.tags,
      });
      this._mintGroup.jup.add(token.address);
    });

    this._extraTokenList.forEach((token) => {
      if (this._blackTokenMap.has(token.address) || this._tokenMap.has(token.address)) return;
      this._tokenMap.set(token.address, {
        ...token,
        type: "extra",
        priority: 1,
        programId:
          token.programId || token.tags.includes("token-2022")
            ? TOKEN_2022_PROGRAM_ID.toBase58()
            : TOKEN_PROGRAM_ID.toBase58(),
      });
      this._mintGroup.extra.add(token.address);
    });

    this._tokenList = Array.from(this._tokenMap).map((data) => data[1]);
  }

  get tokenList(): TokenInfo[] {
    return this._tokenList;
  }
  get tokenMap(): Map<string, TokenInfo> {
    return this._tokenMap;
  }
  get blackTokenMap(): Set<string> {
    return this._blackTokenMap;
  }
  get mintGroup(): { official: Set<string>; jup: Set<string> } {
    return this._mintGroup;
  }
  get whiteListMap(): Set<string> {
    return this._whiteMap;
  }

  /** === util functions === */

  public async getTokenInfo(mint: string | PublicKey): Promise<ApiV3Token> {
    if (!mint) throw new Error("please input mint");
    const mintStr = mint.toString();
    const info = this._tokenMap.get(mintStr);
    if (info) return info;
    if (mintStr.toLocaleUpperCase() === "SOL") return SOL_INFO;

    const apiTokenInfo = (await this.scope.api.getTokenInfo([mintStr]))[0];
    if (apiTokenInfo) {
      this._mintGroup.extra.add(mintStr);
      this._tokenMap.set(mintStr, { ...apiTokenInfo, priority: 2 });
      return apiTokenInfo;
    }

    const onlineInfo = await this.scope.connection.getAccountInfo(new PublicKey(mintStr));
    if (!onlineInfo) throw new Error(`mint address not found: ${mintStr}`);
    const data = MintLayout.decode(onlineInfo.data);
    const mintSymbol = mintStr.toString().substring(0, 6);
    const fullInfo = {
      chainId: 101,
      address: mintStr,
      programId: onlineInfo.owner.toBase58(),
      logoURI: "",
      symbol: mintSymbol,
      name: mintSymbol,
      decimals: data.decimals,
      tags: [],
      extensions: {},
      priority: 0,
      type: "unknown",
    };
    this._mintGroup.extra.add(mintStr);
    this._tokenMap.set(mintStr, fullInfo);
    return fullInfo;
  }
}
