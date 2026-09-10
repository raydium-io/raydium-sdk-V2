import BN from "bn.js";
import {
  LAUNCHPAD_CURVE_RULE_CONSTANT_PRODUCT_ONLY_FIELDS,
  LAUNCHPAD_MAX_CONSTRAINTS_PER_GROUP,
  LAUNCHPAD_MAX_CURVE_RULE_GROUPS,
  LaunchpadCurveRuleBaseTokenProgram,
  LaunchpadCurveRuleConstraint,
  LaunchpadCurveRuleField,
  LaunchpadCurveRuleInfo,
  LaunchpadCurveRuleOp,
} from "./type";

const RATE_DENOMINATOR = new BN(1_000_000);


export interface LaunchpadCurveRuleContext {
  curveType: number;
  migrateType: number;
  migrateCpmmFeeOn: number;
  supply: BN;
  totalSellA: BN;
  totalFundRaisingB: BN;
  totalLockedAmount: BN;
  cliffPeriod: BN;
  unlockPeriod: BN;
  baseTokenProgram: LaunchpadCurveRuleBaseTokenProgram;
  transferFee?: { basisPoints: number; maximumFee: BN };
  unixTimestamp: BN;
}


export function getCurveRuleFieldValue(
  context: LaunchpadCurveRuleContext,
  field: number,
): BN | undefined {
  const rateOf = (amount: BN): BN | undefined =>
    context.supply.isZero() ? undefined : amount.mul(RATE_DENOMINATOR).div(context.supply);
  const migrateAmountA = (): BN | undefined => {
    const rest = context.supply.sub(context.totalSellA).sub(context.totalLockedAmount);
    return rest.isNeg() ? undefined : rest;
  };

  switch (field) {
    case LaunchpadCurveRuleField.CurveType:
      return new BN(context.curveType);
    case LaunchpadCurveRuleField.MigrateType:
      return new BN(context.migrateType);
    case LaunchpadCurveRuleField.MigrateCpmmFeeOn:
      return new BN(context.migrateCpmmFeeOn);
    case LaunchpadCurveRuleField.Supply:
      return context.supply;
    case LaunchpadCurveRuleField.TotalSellA:
      return context.totalSellA;
    case LaunchpadCurveRuleField.TotalFundRaisingB:
      return context.totalFundRaisingB;
    case LaunchpadCurveRuleField.TotalLockedAmount:
      return context.totalLockedAmount;
    case LaunchpadCurveRuleField.CliffPeriod:
      return context.cliffPeriod;
    case LaunchpadCurveRuleField.UnlockPeriod:
      return context.unlockPeriod;
    case LaunchpadCurveRuleField.BaseTokenProgram:
      return new BN(context.baseTokenProgram);
    case LaunchpadCurveRuleField.TransferFeeEnabled:
      return new BN(context.transferFee === undefined ? 0 : 1);
    case LaunchpadCurveRuleField.TransferFeeBasisPoints:
      return new BN(context.transferFee?.basisPoints ?? 0);
    case LaunchpadCurveRuleField.TransferFeeMaximumFee:
      return context.transferFee?.maximumFee ?? new BN(0);
    case LaunchpadCurveRuleField.SellRateA:
      return rateOf(context.totalSellA);
    case LaunchpadCurveRuleField.LockRate:
      return rateOf(context.totalLockedAmount);
    case LaunchpadCurveRuleField.MigrateAmountA:
      return migrateAmountA();
    case LaunchpadCurveRuleField.MigrateRateA: {
      const amount = migrateAmountA();
      return amount === undefined ? undefined : rateOf(amount);
    }
    case LaunchpadCurveRuleField.FundRaisingRateB:
      return rateOf(context.totalFundRaisingB);
    case LaunchpadCurveRuleField.UnixTimestamp:
      return context.unixTimestamp;
    default:
      return undefined;
  }
}

export function isCurveRuleConstraintSatisfied(
  constraint: LaunchpadCurveRuleConstraint,
  context: LaunchpadCurveRuleContext,
): boolean {
  const actual = getCurveRuleFieldValue(context, constraint.field);
  if (actual === undefined) return false;

  switch (constraint.op) {
    case LaunchpadCurveRuleOp.Eq:
      return actual.eq(constraint.value);
    case LaunchpadCurveRuleOp.Gte:
      return actual.gte(constraint.value);
    case LaunchpadCurveRuleOp.Lte:
      return actual.lte(constraint.value);
    case LaunchpadCurveRuleOp.Neq:
      return !actual.eq(constraint.value);
    default:
      return false;
  }
}

export interface CurveRuleUnsatisfiedConstraint extends LaunchpadCurveRuleConstraint {
  /** the value these launch parameters produce, `undefined` when it cannot be computed */
  actual?: BN;
}

export interface CurveRuleCheckResult {
  ok: boolean;
  matchedGroupId?: number;
  groupFailures: { groupId: number; unsatisfied: CurveRuleUnsatisfiedConstraint[] }[];
}

export function checkLaunchAgainstCurveRule({
  rule,
  context,
}: {
  rule: Pick<LaunchpadCurveRuleInfo, "groups"> | undefined;
  context: LaunchpadCurveRuleContext;
}): CurveRuleCheckResult {
  const groups = rule?.groups ?? [];
  if (groups.length === 0) return { ok: true, groupFailures: [] };

  const groupFailures: CurveRuleCheckResult["groupFailures"] = [];
  for (const group of groups) {
    const unsatisfied = group.constraints
      .filter((constraint) => !isCurveRuleConstraintSatisfied(constraint, context))
      .map((constraint) => ({ ...constraint, actual: getCurveRuleFieldValue(context, constraint.field) }));

    if (unsatisfied.length === 0) return { ok: true, matchedGroupId: group.groupId, groupFailures: [] };
    groupFailures.push({ groupId: group.groupId, unsatisfied });
  }

  return { ok: false, groupFailures };
}

export interface CurveRuleWriteCheckResult {
  ok: boolean;
  errors: {
    code:
    | "CurveRuleGroupsExceeded"
    | "InvalidCurveRuleConstraint"
    | "CurveRuleFieldNotSupportedByCurve";
    message: string;
  }[];
}

export function checkCurveRuleGroupWritable({
  groupId,
  constraints,
  curveType,
  existingGroupIds = [],
}: {
  groupId: number;
  constraints: LaunchpadCurveRuleConstraint[];
  curveType: number;
  existingGroupIds?: number[];
}): CurveRuleWriteCheckResult {
  const errors: CurveRuleWriteCheckResult["errors"] = [];

  if (!existingGroupIds.includes(groupId) && existingGroupIds.length >= LAUNCHPAD_MAX_CURVE_RULE_GROUPS) {
    errors.push({
      code: "CurveRuleGroupsExceeded",
      message: `a rule holds at most ${LAUNCHPAD_MAX_CURVE_RULE_GROUPS} groups, and group ${groupId} would be a new one`,
    });
  }

  if (constraints.length > LAUNCHPAD_MAX_CONSTRAINTS_PER_GROUP) {
    errors.push({
      code: "InvalidCurveRuleConstraint",
      message: `a group holds at most ${LAUNCHPAD_MAX_CONSTRAINTS_PER_GROUP} constraints, got ${constraints.length}`,
    });
  }

  const seen = new Set<string>();
  constraints.forEach((constraint, index) => {
    if (constraint.field > LaunchpadCurveRuleField.UnixTimestamp) {
      errors.push({
        code: "InvalidCurveRuleConstraint",
        message: `constraint ${index}: unknown field id ${constraint.field}`,
      });
    }
    if (constraint.op > LaunchpadCurveRuleOp.Neq) {
      errors.push({
        code: "InvalidCurveRuleConstraint",
        message: `constraint ${index}: unknown op id ${constraint.op}`,
      });
    }

    const key = `${constraint.field}/${constraint.op}`;
    if (seen.has(key)) {
      errors.push({
        code: "InvalidCurveRuleConstraint",
        message: `constraint ${index}: field ${constraint.field} already has an op ${constraint.op} constraint in this group. A range uses two different ops on one field`,
      });
    }
    seen.add(key);

    if (
      curveType !== 0 &&
      LAUNCHPAD_CURVE_RULE_CONSTANT_PRODUCT_ONLY_FIELDS.includes(constraint.field)
    ) {
      errors.push({
        code: "CurveRuleFieldNotSupportedByCurve",
        message: `constraint ${index}: field ${constraint.field} reads totalSellA, which curve type ${curveType} derives itself, so the program refuses it on this config`,
      });
    }
  });

  return { ok: errors.length === 0, errors };
}
