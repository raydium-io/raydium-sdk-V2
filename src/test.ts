import { Connection } from "@solana/web3.js";
import { Raydium } from "./raydium";

async function test() {
  const a = await Raydium.load({
    connection: new Connection("https://rpc.asdf1234.win"),
  });
  console.log(123123, a);
}

test();
