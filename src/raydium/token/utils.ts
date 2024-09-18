import { Connection, PublicKey } from "@solana/web3.js";
import { MintLayout, RawMint, TOKEN_PROGRAM_ID, TransferFeeConfigLayout } from "@solana/spl-token";
import { BigNumberish } from "@/common/bignumber";
import { Token, TokenAmount } from "../../module";
import { SOL_INFO, TOKEN_WSOL } from "./constant";
import { TokenInfo } from "./type";

import { ApiV3Token } from "../../api";
import { solToWSol } from "@/common";

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
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //@ts-ignore
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
      mint: solToWSol(props.address).toBase58(),
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

export const toApiV3Token = ({
  address,
  programId,
  decimals,
  ...props
}: {
  address: string;
  programId: string;
  decimals: number;
} & Partial<ApiV3Token>): ApiV3Token => ({
  chainId: 101,
  address: solToWSol(address).toBase58(),
  programId,
  logoURI: "",
  symbol: "",
  name: "",
  decimals,
  tags: [],
  extensions: props.extensions || {},
  ...props,
});

export const toFeeConfig = (
  config?: ReturnType<typeof TransferFeeConfigLayout.decode> | undefined | null,
): ApiV3Token["extensions"]["feeConfig"] | undefined =>
  config
    ? {
        ...config,
        transferFeeConfigAuthority: config.transferFeeConfigAuthority.toBase58(),
        withdrawWithheldAuthority: config.withdrawWithheldAuthority.toBase58(),
        withheldAmount: config.withheldAmount.toString(),
        olderTransferFee: {
          ...config.olderTransferFee,
          epoch: config.olderTransferFee.epoch.toString(),
          maximumFee: config.olderTransferFee.maximumFee.toString(),
        },
        newerTransferFee: {
          ...config.newerTransferFee,
          epoch: config.newerTransferFee.epoch.toString(),
          maximumFee: config.newerTransferFee.maximumFee.toString(),
        },
      }
    : undefined;
