import { Connection, clusterApiUrl } from "@solana/web3.js";
import { Raydium } from "../src/index";

async function init() {
  const raydium = await Raydium.load({
    connection: new Connection(clusterApiUrl("mainnet-beta")),
    disableFeatureCheck: true,
    disableLoadToken: true,
  });
  const r = await raydium.liquidity.getAmmPoolKeys("AVs9TA4nWDzfPJE9gGVNJMVhcQy3V9PGazuz33BfG2RA");
  console.log(123123, r);
}

init();
