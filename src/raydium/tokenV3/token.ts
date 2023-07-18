import { PublicKey } from "@solana/web3.js";
import { Price, Token, TokenAmount, Fraction } from "../../module";
import { PublicKeyish, validateAndParsePublicKey, SOLMint } from "../../common/pubKey";
import { BigNumberish, parseNumberInfo, toBN } from "../../common/bignumber";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { LoadParams } from "../type";

import { TokenInfo } from "./type";
import { parseTokenPrice } from "./utils";
import BN from "bn.js";

export interface MintToTokenAmount {
  mint: PublicKeyish;
  amount: BigNumberish;
  decimalDone?: boolean;
}

export default class TokenModule extends ModuleBase {
  private _tokenList: TokenInfo[] = [];
  private _tokenMap: Map<string, TokenInfo> = new Map();
  private _blackTokenMap: Map<string, TokenInfo> = new Map();
  private _tokenPrice: Map<string, Price> = new Map();

  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(params?: LoadParams): Promise<void> {
    this.checkDisabled();
    const { mintList, jup, blacklist } = await this.scope.fetchV3TokenList(params?.forceUpdate);
    blacklist.forEach((token) => {
      this._blackTokenMap.set(token.address, { ...token, priority: 0 });
    });

    mintList.forEach((token) => {
      if (this._blackTokenMap.has(token.address)) return;
      this._tokenMap.set(token.address, { ...token, priority: 2 });
    });

    jup.forEach((token) => {
      if (this._blackTokenMap.has(token.address)) return;
      this._tokenMap.set(token.address, { ...token, priority: 1 });
    });

    this._tokenList = Array.from(this._tokenMap).map((data) => data[1]);
  }

  get tokenList(): TokenInfo[] {
    return this._tokenList;
  }
  get tokenMap(): Map<string, TokenInfo> {
    return this._tokenMap;
  }
  get blackTokenMap(): Map<string, TokenInfo> {
    return this._blackTokenMap;
  }
  get tokenPriceMap(): Map<string, Price> {
    return this._tokenPrice;
  }

  public async fetchTokenPrices(preloadRaydiumPrice?: Record<string, number>): Promise<Map<string, Price>> {
    const coingeckoTokens = this._tokenList.filter(
      (token) => !!token.extensions?.coingeckoId && token.address !== PublicKey.default.toBase58(),
    );
    const coingeckoIds = coingeckoTokens.map((token) => token.extensions.coingeckoId!);
    const coingeckoPriceRes = await this.scope.api.getCoingeckoPrice(coingeckoIds);

    const coingeckoPrices: { [key: string]: Price } = coingeckoTokens.reduce(
      (acc, token) =>
        coingeckoPriceRes[token.extensions.coingeckoId!]?.usd
          ? {
              ...acc,
              [token.address]: parseTokenPrice({
                token: this._tokenMap.get(token.address)!,
                numberPrice: coingeckoPriceRes[token.extensions.coingeckoId!].usd!,
                decimalDone: true,
              }),
            }
          : acc,
      {},
    );

    const raydiumPriceRes = preloadRaydiumPrice || (await this.scope.api.getRaydiumTokenPrice());
    const raydiumPrices: { [key: string]: Price } = Object.keys(raydiumPriceRes).reduce(
      (acc, key) =>
        this._tokenMap.get(key)
          ? {
              ...acc,
              [key]: parseTokenPrice({
                token: this._tokenMap.get(key)!,
                numberPrice: raydiumPriceRes[key],
                decimalDone: true,
              }),
            }
          : acc,
      {},
    );
    this._tokenPrice = new Map([...Object.entries(coingeckoPrices), ...Object.entries(raydiumPrices)]);
    return this._tokenPrice;
  }

  /** === util functions === */

  public mintToToken(mint: PublicKeyish): Token {
    const _mint = validateAndParsePublicKey({ publicKey: mint });
    const tokenInfo = this._tokenMap.get(_mint.toBase58());
    if (!tokenInfo) this.logAndCreateError("token not found, mint:", _mint.toBase58());
    const { decimals, name, symbol } = tokenInfo!;
    const isSol = _mint.equals(SOLMint);
    return new Token({ decimals, name, symbol, skipMint: isSol, mint: isSol ? "" : mint });
  }

  public mintToTokenAmount({ mint, amount, decimalDone }: MintToTokenAmount): TokenAmount {
    const token = this.mintToToken(mint);

    if (decimalDone) {
      const numberDetails = parseNumberInfo(amount);
      const amountBigNumber = toBN(new Fraction(numberDetails.numerator, numberDetails.denominator));
      return new TokenAmount(token, amountBigNumber);
    }
    return new TokenAmount(token, this.decimalAmount({ mint, amount, decimalDone }));
  }

  public decimalAmount({ mint, amount }: MintToTokenAmount): BN {
    const numberDetails = parseNumberInfo(amount);
    const token = this.mintToToken(mint);
    return toBN(new Fraction(numberDetails.numerator, numberDetails.denominator).mul(new BN(10 ** token.decimals)));
  }

  public uiAmount({ mint, amount }: MintToTokenAmount): string {
    const numberDetails = parseNumberInfo(amount);
    const token = this.mintToToken(mint);
    if (!token) return "";
    return new Fraction(numberDetails.numerator, numberDetails.denominator)
      .div(new BN(10 ** token.decimals))
      .toSignificant(token.decimals);
  }
}
