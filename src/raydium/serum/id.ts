import { PublicKey } from "@solana/web3.js";
import { SERUM_PROGRAM_ID_V3 } from "../../common/programId";
import { SerumVersion } from "./type";

// serum program id string => serum version
export const SERUM_PROGRAMID_TO_VERSION: {
  [key: string]: SerumVersion;
} = {
  [SERUM_PROGRAM_ID_V3.toBase58()]: 3,
};

// serum version => serum program id
export const SERUM_VERSION_TO_PROGRAMID: { [key in SerumVersion]?: PublicKey } & {
  [K: number]: PublicKey;
} = {
  3: SERUM_PROGRAM_ID_V3,
};
