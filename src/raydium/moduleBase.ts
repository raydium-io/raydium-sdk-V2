import { PublicKey } from "@solana/web3.js";

import { createLogger, Logger } from "../common/logger";
import { TxBuilder } from "../common/txTool/txTool";

import { Raydium } from "./";

export interface ModuleBaseProps {
  scope: Raydium;
  moduleName: string;
}

const joinMsg = (...args: (string | number | Record<string, any>)[]): string =>
  args
    .map((arg) => {
      try {
        return typeof arg === "object" ? JSON.stringify(arg) : arg;
      } catch {
        return arg;
      }
    })
    .join(", ");
export default class ModuleBase {
  public scope: Raydium;
  private disabled = false;
  protected logger: Logger;

  constructor({ scope, moduleName }: ModuleBaseProps) {
    this.scope = scope;
    this.logger = createLogger(moduleName);
  }

  protected createTxBuilder(feePayer?: PublicKey): TxBuilder {
    this.scope.checkOwner();
    return new TxBuilder({
      connection: this.scope.connection,
      feePayer: feePayer || this.scope.ownerPubKey,
      cluster: this.scope.cluster,
      owner: this.scope.owner,
      blockhashCommitment: this.scope.blockhashCommitment,
      api: this.scope.api,
      signAllTransactions: this.scope.signAllTransactions,
    });
  }

  public logDebug(...args: (string | number | Record<string, any>)[]): void {
    this.logger.debug(joinMsg(args));
  }

  public logInfo(...args: (string | number | Record<string, any>)[]): void {
    this.logger.info(joinMsg(args));
  }

  public logAndCreateError(...args: (string | number | Record<string, any>)[]): void {
    const message = joinMsg(args);
    // this.logger.error(message);
    throw new Error(message);
  }

  public checkDisabled(): void {
    if (this.disabled || !this.scope) this.logAndCreateError("module not working");
  }
}
