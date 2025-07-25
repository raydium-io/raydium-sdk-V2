import { PublicKey } from "@solana/web3.js";

// raydium
export const FARM_PROGRAM_ID_V3 = new PublicKey("EhhTKczWMGQt46ynNeRX1WfeagwwJd7ufHvCDjRxjo5Q");
// temp fusion
export const FARM_PROGRAM_ID_V4 = new PublicKey("CBuCnLe26faBpcBP2fktp4rp8abpcAnTWft6ZrP5Q4T");
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
export const CLMM_LOCK_PROGRAM_ID = new PublicKey("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE");
export const CLMM_LOCK_AUTH_ID = new PublicKey("kN1kEznaF5Xbd8LYuqtEFcxzWSBk5Fv6ygX6SqEGJVy");

export const MODEL_DATA_PUBKEY = new PublicKey("CDSr3ssLcRB6XYPJwAfFt18MZvEZp4LjHcvzBVZ45duo");

export const Router = new PublicKey("routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS");
export const FEE_DESTINATION_ID = new PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5");

export const IDO_PROGRAM_ID_V1 = new PublicKey("6FJon3QE27qgPVggARueB22hLvoh22VzJpXv4rBEoSLF");
export const IDO_PROGRAM_ID_V2 = new PublicKey("CC12se5To1CdEuw7fDS27B7Geo5jJyL7t5UK2B44NgiH");
export const IDO_PROGRAM_ID_V3 = new PublicKey("9HzJyW1qZsEiSfMUf6L2jo3CcTKAyBmSyKdwQeYisHrC");
export const IDO_PROGRAM_ID_V4 = new PublicKey("DropEU8AvevN3UrXWXTMuz3rqnMczQVNjq3kcSdW2SQi");

export const CREATE_CPMM_POOL_PROGRAM = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
export const CREATE_CPMM_POOL_AUTH = new PublicKey("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL");
export const CREATE_CPMM_POOL_FEE_ACC = new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8");

export const LOCK_CPMM_PROGRAM = new PublicKey("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE");

export const LOCK_CPMM_AUTH = new PublicKey("3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH");

export const LAUNCHPAD_PROGRAM = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
export const LAUNCHPAD_AUTH = new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");

export const DEV_LAUNCHPAD_PROGRAM = new PublicKey("DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6");
export const DEV_LAUNCHPAD_AUTH = new PublicKey("5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq");

export const LAUNCHPAD_PLATFORM = new PublicKey("4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4");

export const LAUNCHPAD_CONFIG = new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX");

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
  CLMM_LOCK_PROGRAM_ID,
  CLMM_LOCK_AUTH_ID,

  FARM_PROGRAM_ID_V3,
  FARM_PROGRAM_ID_V4,
  FARM_PROGRAM_ID_V5,
  FARM_PROGRAM_ID_V6,

  OPEN_BOOK_PROGRAM,
  SERUM_PROGRAM_ID_V3,

  UTIL1216,

  Router,

  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_AUTH,
  CREATE_CPMM_POOL_FEE_ACC,

  LOCK_CPMM_PROGRAM,
  LOCK_CPMM_AUTH,

  LAUNCHPAD_PROGRAM,
  LAUNCHPAD_AUTH,

  LAUNCHPAD_PLATFORM,
  LAUNCHPAD_CONFIG,

  FEE_DESTINATION_ID,

  MODEL_DATA_PUBKEY,
};

export type ProgramIdConfig = Partial<typeof ALL_PROGRAM_ID>;

export const DEVNET_PROGRAM_ID: typeof ALL_PROGRAM_ID = {
  OPEN_BOOK_PROGRAM: new PublicKey("EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj"),
  SERUM_PROGRAM_ID_V3: new PublicKey("Ray1111111111111111111111111111111111111111"),
  AMM_V4: new PublicKey("DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav"),
  AMM_STABLE: new PublicKey("DRayDdXc1NZQ9C3hRWmoSf8zK4iapgMnjdNZWrfwsP8m"),

  CLMM_PROGRAM_ID: new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"),
  CLMM_LOCK_PROGRAM_ID: new PublicKey("DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX"),
  CLMM_LOCK_AUTH_ID: new PublicKey("6Aoh8h2Lw2m5UGxYR8AdAL87jTWYeKoxM52mJRzfYwN"),

  CREATE_CPMM_POOL_PROGRAM: new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"),
  CREATE_CPMM_POOL_AUTH: new PublicKey("CXniRufdq5xL8t8jZAPxsPZDpuudwuJSPWnbcD5Y5Nxq"),
  CREATE_CPMM_POOL_FEE_ACC: new PublicKey("3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy"),

  LOCK_CPMM_PROGRAM: new PublicKey("DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX"),
  LOCK_CPMM_AUTH: new PublicKey("7qWVV8UY2bRJfDLP4s37YzBPKUkVB46DStYJBpYbQzu3"),

  UTIL1216: PublicKey.default,

  Router: new PublicKey("DRaybByLpbUL57LJARs3j8BitTxVfzBg351EaMr5UTCd"),

  FARM_PROGRAM_ID_V3: new PublicKey("DRayWyrLmEW5KEeqs8kdTMMaBabapqagaBC7KWpGtJeZ"),
  FARM_PROGRAM_ID_V4: new PublicKey("Ray1111111111111111111111111111111111111111"),
  FARM_PROGRAM_ID_V5: new PublicKey("DRayiCGSZgku1GTK6rXD6mVDdingXy6APAH1R6R5L2LC"),
  FARM_PROGRAM_ID_V6: new PublicKey("DRayzbYakXs45ELHkzH6vC3fuhQqTAnv5A68gdFuvZyZ"),

  LAUNCHPAD_PROGRAM: new PublicKey("DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6"),
  LAUNCHPAD_AUTH: new PublicKey("5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq"),

  LAUNCHPAD_PLATFORM: new PublicKey("2Jx4KTDrVSdWNazuGpcA8n3ZLTRGGBDxAWhuKe2Xcj2a"),
  LAUNCHPAD_CONFIG: new PublicKey("7ZR4zD7PYfY2XxoG1Gxcy2EgEeGYrpxrwzPuwdUBssEt"),

  FEE_DESTINATION_ID: new PublicKey("9y8ENuuZ3b19quffx9hQvRVygG5ky6snHfRvGpuSfeJy"),

  MODEL_DATA_PUBKEY: new PublicKey("Ray1111111111111111111111111111111111111111"),
};
