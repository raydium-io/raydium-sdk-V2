import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { LoadParams } from "../type";

export default class TokenModule extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(params?: LoadParams): Promise<void> {
    this.checkDisabled();
    await this.scope.fetchV3TokenList(params?.forceUpdate);
  }
}
