import { nu64, struct, u8 } from "../../marshmallow";

export const purchaseLayout = struct([u8("instruction"), nu64("amount")]);
export const claimLayout = struct([u8("instruction")]);
