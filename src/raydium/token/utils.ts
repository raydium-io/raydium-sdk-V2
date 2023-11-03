import { Connection, PublicKey } from "@solana/web3.js";
import { MintLayout, RawMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Price, Token, TokenAmount } from "@/module";
import { parseNumberInfo, Numberish, BigNumberish } from "@/common/bignumber";
import { TokenInfo } from "./type";
import { SOL_INFO, TOKEN_WSOL } from "./constant";

import BN from "bn.js";
import { ApiV3Token } from "@/api";

export function parseTokenPrice(params: { token: TokenInfo; numberPrice: Numberish; decimalDone?: boolean }): Price {
  const { token, numberPrice, decimalDone } = params;
  const usdCurrency = new Token({ mint: "", decimals: 6, symbol: "usd", name: "usd", skipMint: true });
  const { numerator, denominator } = parseNumberInfo(numberPrice);
  const parsedNumerator = decimalDone ? new BN(numerator).mul(new BN(10).pow(new BN(token.decimals))) : numerator;
  const parsedDenominator = new BN(denominator).mul(new BN(10).pow(new BN(usdCurrency.decimals)));

  return new Price({
    baseToken: usdCurrency,
    denominator: parsedDenominator.toString(),
    quoteToken: new Token({ ...token, skipMint: true, mint: "" }),
    numerator: parsedNumerator.toString(),
  });
}

export const parseTokenInfo = async ({
  connection,
  mint,
}: {
  connection: Connection;
  mint: PublicKey | string;
}): Promise<RawMint | undefined> => {
  const accountData = await connection.getAccountInfo(new PublicKey(mint));
  if (!accountData || accountData.data.length !== MintLayout.span) return;
  const tokenInfo = MintLayout.decode(accountData.data);
  return tokenInfo;
};

export const toTokenInfo = ({
  mint,
  decimals,
  programId = TOKEN_PROGRAM_ID,
  logoURI = "",
  priority = 3,
}: {
  mint: PublicKey;
  decimals: number;
  programId?: PublicKey | string;
  priority?: number;
  logoURI?: string;
}): TokenInfo => {
  const pubStr = mint.toBase58().substring(0, 6);
  return {
    address: mint.toBase58(),
    decimals,
    symbol: pubStr,
    logoURI,
    extensions: {},
    chainId: 101,
    programId: programId.toString(),
    name: pubStr,
    tags: [],
    priority,
  };
};

export const toToken = (props: Omit<TokenInfo, "priority">): Token =>
  new Token({
    mint: props.address,
    decimals: props.decimals,
    symbol: props.symbol,
    name: props.name,
  });

export const toTokenAmount = ({
  amount,
  isRaw,
  name,
  ...props
}: Omit<TokenInfo, "priority"> & {
  amount: BigNumberish;
  isRaw?: boolean;
  name?: string;
}): TokenAmount =>
  new TokenAmount(
    new Token({
      mint: props.address,
      decimals: props.decimals,
      symbol: props.symbol,
      name,
    }),
    amount,
    isRaw,
    name,
  );

export function solToWSolToken<T extends ApiV3Token | TokenInfo>(token: T): T {
  if (token.address === SOL_INFO.address) return TOKEN_WSOL as T;
  return token;
}

export function wSolToSolToken<T extends ApiV3Token | TokenInfo>(token: T): T {
  if (token.address === TOKEN_WSOL.address) return SOL_INFO as T;
  return token;
}
