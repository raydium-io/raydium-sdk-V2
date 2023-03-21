import { TokenProps, Token } from "../../module/token";

export type ExtensionKey = "coingeckoId" | "website" | "whitepaper";
export type Extensions = { [key in ExtensionKey]?: string };

// Native SOL
export interface NativeTokenInfo {
  readonly symbol: string;
  readonly name: string;

  readonly decimals: number;
}

// SPL token
export interface SplTokenInfo extends NativeTokenInfo {
  // readonly chainId: ENV;
  readonly mint: string;

  readonly extensions: Extensions;
}

export interface TokenJson {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  extensions: {
    coingeckoId?: string;
  };
  icon: string;
  hasFreeze?: boolean;
}

export type SplToken = TokenProps & {
  icon: string;
  id: string;
  extensions: {
    [key in "coingeckoId" | "website" | "whitepaper"]?: string;
  };
  userAdded?: boolean; // only if token is added by user
};

export type LpToken = Token & {
  isLp: true;
  base: SplToken;
  quote: SplToken;
  icon: string;
  /** mint. for `<TokenSelector>`*/
  id: string;
  extensions: {
    [key in "coingeckoId" | "website" | "whitepaper"]?: string;
  };
};
