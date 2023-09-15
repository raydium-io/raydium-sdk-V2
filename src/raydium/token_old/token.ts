import { RawMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { BigNumberish, parseNumberInfo, toBN, toTokenPrice } from "../../common/bignumber";
import { PublicKeyish, SOLMint, validateAndParsePublicKey } from "../../common/pubKey";
import { Token, TokenAmount, Fraction, Price } from "../../module";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { LoadParams } from "../type";

import { quantumSOLHydratedTokenJsonInfo, TOKEN_WSOL } from "./constant";
import { SplToken, TokenJson } from "./type";
import { getTokenInfo } from "./util";

export interface MintToTokenAmount {
  mint: PublicKeyish;
  amount: BigNumberish;
  decimalDone?: boolean;
}

export default class TokenModule extends ModuleBase {
  private _tokens: TokenJson[] = [];
  private _tokenMap: Map<string, SplToken> = new Map();
  private _tokenPrice: Map<string, Price> = new Map();
  private _mintList: {
    official: string[];
    unOfficial: string[];
    unNamed: string[];
    otherLiquiditySupportedMints: string[];
  };
  private _mintSets: {
    official: Set<string>;
    unOfficial: Set<string>;
    unNamed: Set<string>;
    otherLiquiditySupportedMints: Set<string>;
  };

  constructor(params: ModuleBaseProps) {
    super(params);
    this._mintList = { official: [], unOfficial: [], unNamed: [], otherLiquiditySupportedMints: [] };
    this._mintSets = {
      official: new Set(),
      unOfficial: new Set(),
      unNamed: new Set(),
      otherLiquiditySupportedMints: new Set(),
    };
  }

  public async load(params?: LoadParams): Promise<void> {
    this.checkDisabled();
    // await this.scope.fetchTokens(params?.forceUpdate);
    // unofficial: solana token list
    // official: raydium token list
    this._mintList = { official: [], unOfficial: [], unNamed: [], otherLiquiditySupportedMints: [] };
    this._tokens = [];
    this._tokenMap = new Map();
    const { data } = this.scope.apiData.tokens || {
      data: { official: [], unOfficial: [], unNamed: [], blacklist: [] },
    };

    const blacklistSet = new Set(data.blacklist);
    [data.official, data.unOfficial, data.unNamed].forEach((tokenGroup, idx) => {
      tokenGroup.forEach((token) => {
        const category = ["official", "unOfficial", "unNamed"][idx];
        if (!blacklistSet.has(token.mint) && token.mint !== SOLMint.toBase58()) {
          this._tokens.push({
            ...token,
            symbol: token.symbol || "",
            name: token.name || "",
          });
          this._mintList[category].push(token.mint);
        }
      });
    });
    this._mintList["official"].push(quantumSOLHydratedTokenJsonInfo.mint.toBase58());
    // this._tokens = sortTokens(this._tokens, this._mintList);
    this._tokens.push({
      ...quantumSOLHydratedTokenJsonInfo,
      mint: SOLMint.toBase58(),
    });
    this._tokens.forEach((token) => {
      this._tokenMap.set(token.mint, {
        ...token,
        id: token.mint,
      });
    });
    this._tokenMap.set(TOKEN_WSOL.mint, { ...TOKEN_WSOL, icon: quantumSOLHydratedTokenJsonInfo.icon, id: "wsol" });
    this._tokenMap.set(SOLMint.toBase58(), { ...quantumSOLHydratedTokenJsonInfo, mint: SOLMint.toBase58() });
    await this.parseAllPoolTokens();
  }

  get allTokens(): TokenJson[] {
    return this._tokens;
  }
  get allTokenMap(): Map<string, SplToken> {
    return this._tokenMap;
  }
  get tokenMints(): { official: string[]; unOfficial: string[] } {
    return this._mintList;
  }
  get tokenPrices(): Map<string, Price> {
    return this._tokenPrice;
  }

  public async isVerifiedToken(mint: PublicKeyish, tokenInfo?: RawMint): Promise<boolean> {
    const mintStr = mint.toString();
    const tokenData = tokenInfo || (await getTokenInfo({ connection: this.scope.connection, mint }));
    if (!tokenData) return false;

    const isAPIToken = this._mintSets.official.has(mintStr) || this._mintSets.unOfficial.has(mintStr);
    if (tokenData.decimals !== null && !isAPIToken && tokenData.freezeAuthorityOption === 1) return false;

    return true;
  }

  public async parseAllPoolTokens(): Promise<void> {
    this._mintList.otherLiquiditySupportedMints = [];
    await this.parseV2PoolTokens();
    await this.parseV3PoolTokens();
    this._mintSets.otherLiquiditySupportedMints = new Set(this._mintList.otherLiquiditySupportedMints);
  }

  public async parseV2PoolTokens(): Promise<void> {
    for (let i = 0; i < this.scope.liquidity.allPools.length; i++) {
      const pool = this.scope.liquidity.allPools[i];
      const toToken = (mint: string, decimals: number): TokenJson => ({
        symbol: mint.substring(0, 6),
        name: mint.substring(0, 6),
        mint,
        decimals,
        extensions: {},
        icon: "",
      });
      if (!this._tokenMap.has(pool.baseMint)) {
        const hasFreeze = !(await this.isVerifiedToken(pool.baseMint));
        const token = { ...toToken(pool.baseMint, pool.baseDecimals), hasFreeze };
        this._tokens.push(token);
        this._tokenMap.set(token.mint, { ...token, id: token.mint });
        this._mintList.otherLiquiditySupportedMints.push(pool.baseMint);
      }
      if (!this._tokenMap.has(pool.quoteMint)) {
        const hasFreeze = !(await this.isVerifiedToken(pool.quoteMint));
        const token = { ...toToken(pool.quoteMint, pool.quoteDecimals), hasFreeze };
        this._tokens.push(token);
        this._tokenMap.set(token.mint, { ...token, id: token.mint });
        this._mintList.otherLiquiditySupportedMints.push(pool.baseMint);
      }
    }
  }

  public async parseV3PoolTokens(): Promise<void> {
    for (let i = 0; i < this.scope.clmm.pools.data.length; i++) {
      const pool = this.scope.clmm.pools.data[i];
      const toToken = (mint: string, decimals: number): TokenJson => ({
        symbol: mint.substring(0, 6),
        name: mint.substring(0, 6),
        mint,
        decimals,
        extensions: {},
        icon: "",
      });
      if (!this._tokenMap.has(pool.mintA)) {
        const hasFreeze = !(await this.isVerifiedToken(pool.mintA));
        const token = { ...toToken(pool.mintA, pool.mintDecimalsA), hasFreeze };
        this._tokens.push(token);
        this._tokenMap.set(token.mint, { ...token, id: token.mint });
      }
      if (!this._tokenMap.has(pool.mintB)) {
        const hasFreeze = !(await this.isVerifiedToken(pool.mintB));
        const token = { ...toToken(pool.mintB, pool.mintDecimalsB), hasFreeze };
        this._tokens.push(token);
        this._tokenMap.set(token.mint, { ...token, id: token.mint });
      }
    }
  }

  public async fetchTokenPrices(preloadRaydiumPrice?: Record<string, number>): Promise<Map<string, Price>> {
    const coingeckoTokens = this.allTokens.filter(
      (token) => !!token.extensions?.coingeckoId && token.mint !== PublicKey.default.toBase58(),
    );
    const coingeckoIds = coingeckoTokens.map((token) => token.extensions.coingeckoId!);
    const coingeckoPriceRes = await this.scope.api.getCoingeckoPrice(coingeckoIds);

    const coingeckoPrices: { [key: string]: Price } = coingeckoTokens.reduce(
      (acc, token) =>
        coingeckoPriceRes[token.extensions.coingeckoId!]?.usd
          ? {
              ...acc,
              [token.mint]: toTokenPrice({
                token: this._tokenMap.get(token.mint)!,
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
              [key]: toTokenPrice({
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

  public mintToToken(mint: PublicKeyish): Token {
    const _mint = validateAndParsePublicKey({ publicKey: mint });
    const tokenInfo = this.allTokenMap.get(_mint.toBase58());
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
