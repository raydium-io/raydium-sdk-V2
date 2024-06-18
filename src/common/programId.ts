import { PublicKey } from "@solana/web3.js";

// raydium
export const FARM_PROGRAM_ID_V3 = new PublicKey("EhhTKczWMGQt46ynNeRX1WfeagwwJd7ufHvCDjRxjo5Q");
// "fusion"
export const FARM_PROGRAM_ID_V5 = new PublicKey("9KEPoZmtHUrBbhWN1v1KWLMkkvwY6WLtAVUCPRtRjP4z");
// echosystem
export const FARM_PROGRAM_ID_V6 = new PublicKey("FarmqiPv5eAj3j1GMdMCMUGXqPUvmquZtMy86QH6rzhG");

export const UTIL1216 = new PublicKey("CLaimxFqjHzgTJtAGHU47NPhg6qrc5sCnpC4tBLyABQS");

export const OPEN_BOOK_PROGRAM = new PublicKey("srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX");
export const SERUM_PROGRAM_ID_V3 = new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");

export const AMM_V4 = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
export const AMM_STABLE = new PublicKey("5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h");
export const LIQUIDITY_POOL_PROGRAM_ID_V5_MODEL = new PublicKey("CDSr3ssLcRB6XYPJwAfFt18MZvEZp4LjHcvzBVZ45duo");
export const CLMM_PROGRAM_ID = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
export const Router = new PublicKey("routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS");
export const FEE_DESTINATION_ID = new PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5");

export const IDO_PROGRAM_ID_V1 = new PublicKey("6FJon3QE27qgPVggARueB22hLvoh22VzJpXv4rBEoSLF");
export const IDO_PROGRAM_ID_V2 = new PublicKey("CC12se5To1CdEuw7fDS27B7Geo5jJyL7t5UK2B44NgiH");
export const IDO_PROGRAM_ID_V3 = new PublicKey("9HzJyW1qZsEiSfMUf6L2jo3CcTKAyBmSyKdwQeYisHrC");
export const IDO_PROGRAM_ID_V4 = new PublicKey("DropEU8AvevN3UrXWXTMuz3rqnMczQVNjq3kcSdW2SQi");

export const CREATE_CPMM_POOL_PROGRAM = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
export const CREATE_CPMM_POOL_AUTH = new PublicKey("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL");
export const CREATE_CPMM_POOL_FEE_ACC = new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8");

export const DEV_CREATE_CPMM_POOL_PROGRAM = new PublicKey("CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW");
export const DEV_CREATE_CPMM_POOL_AUTH = new PublicKey("7rQ1QFNosMkUCuh7Z7fPbTHvh73b68sQYdirycEzJVuw");
export const DEV_CREATE_CPMM_POOL_FEE_ACC = new PublicKey("G11FKBRaAkHAKuLCgLM6K6NUc9rTjPAznRCjZifrTQe2");

export const IDO_ALL_PROGRAM = {
  IDO_PROGRAM_ID_V1,
  IDO_PROGRAM_ID_V2,
  IDO_PROGRAM_ID_V3,
  IDO_PROGRAM_ID_V4,
};

export const ALL_PROGRAM_ID = {
  AMM_V4,
  AMM_STABLE,
  CLMM_PROGRAM_ID,

  FARM_PROGRAM_ID_V3,
  FARM_PROGRAM_ID_V5,
  FARM_PROGRAM_ID_V6,

  OPEN_BOOK_PROGRAM,
  SERUM_PROGRAM_ID_V3,

  UTIL1216,

  Router,

  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_AUTH,
  CREATE_CPMM_POOL_FEE_ACC,
};

export type ProgramIdConfig = Partial<typeof ALL_PROGRAM_ID>;

export const DEVNET_PROGRAM_ID = {
  SERUM_MARKET: PublicKey.default,
  OPENBOOK_MARKET: new PublicKey("EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj"),

  UTIL1216: PublicKey.default,

  FarmV3: new PublicKey("85BFyr98MbCUU9MVTEgzx1nbhWACbJqLzho6zd6DZcWL"),
  FarmV5: new PublicKey("EcLzTrNg9V7qhcdyXDe2qjtPkiGzDM2UbdRaeaadU5r2"),
  FarmV6: new PublicKey("Farm2hJLcqPtPg8M4rR6DMrsRNc5TPm5Cs4bVQrMe2T7"),

  AmmV4: new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8"),
  AmmStable: new PublicKey("DDg4VmQaJV9ogWce7LpcjBA9bv22wRp5uaTPa5pGjijF"),

  CLMM: new PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH"),

  Router: new PublicKey("BVChZ3XFEwTMUk1o9i3HAf91H6mFxSwa5X2wFAWhYPhU"),

  CREATE_CPMM_POOL_PROGRAM: DEV_CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_AUTH: DEV_CREATE_CPMM_POOL_AUTH,
  CREATE_CPMM_POOL_FEE_ACC: DEV_CREATE_CPMM_POOL_FEE_ACC,

  FEE_DESTINATION_ID: new PublicKey("3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR"),
};
