import { ApiV3Token } from "../../api/type";
import { Token, TokenProps } from "../../module/token";

export type TokenInfo = ApiV3Token & {
  priority: number;
  userAdded?: boolean;
  type?: string;
};

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
