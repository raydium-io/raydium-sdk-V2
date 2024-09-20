import { Connection, clusterApiUrl } from "@solana/web3.js";
import { Raydium } from "../src/index";

async function init() {
  const raydium = await Raydium.load({
    connection: new Connection(clusterApiUrl("mainnet-beta")),
    disableFeatureCheck: true,
    disableLoadToken: true,
  });
}

init();
