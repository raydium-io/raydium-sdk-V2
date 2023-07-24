import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { LoadParams } from "../type";

export default class LiquidityModule extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(params?: LoadParams): Promise<void> {
    this.checkDisabled();
    // await this.scope.fetchV3LiquidityPoolList(params?.forceUpdate);
  }
}
