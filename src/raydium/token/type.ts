import { ApiV3Token } from "../../api/type";

export type TokenInfo = ApiV3Token & {
  priority: number;
  userAdded?: boolean;
  type?: string;
};
