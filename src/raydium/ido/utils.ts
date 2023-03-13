import { SdkIdoInfo, TicketInfo, HydratedIdoInfo, TicketTailNumberInfo } from "./type";

export function getDepositedTickets(idoInfo: SdkIdoInfo): TicketInfo[] {
  if (!idoInfo.ledger) return [];
  const begin = Number(idoInfo.ledger.startNumber);
  const end = Number(idoInfo.ledger.endNumber);
  return Array.from({ length: end - begin + 1 }, (_, i) => ({ no: begin + i }));
}

export function isTicketWin(ticketNumber: number, idoInfo: SdkIdoInfo): boolean | undefined {
  const luckyNumbers = idoInfo.state?.luckyNumbers;
  const isTargeted = luckyNumbers?.some(
    ({ digits, number, endRange }) =>
      Number(digits) &&
      Number(ticketNumber) <= Number(endRange) &&
      String(ticketNumber)
        .padStart(Number(digits), "0")
        .endsWith(String(number).padStart(Number(digits), "0")),
  );
  return isTargeted;
}

export function getWinningTickets(idoInfo: SdkIdoInfo): TicketInfo[] {
  const isWinning = idoInfo.state?.isWinning.toNumber();
  // 0 not roll
  // 1 hit not win
  if (isWinning === 1) return getDepositedTickets(idoInfo).filter((ticket) => !isTicketWin(ticket.no, idoInfo));
  // 2 hit is win
  if (isWinning === 2) return getDepositedTickets(idoInfo).filter((ticket) => isTicketWin(ticket.no, idoInfo));
  // 3 all win
  if (isWinning === 3) return getDepositedTickets(idoInfo);
  return [];
}

export function getWinningTicketsTailNumbers(
  idoInfo: SdkIdoInfo,
): HydratedIdoInfo["winningTicketsTailNumber"] | undefined {
  if (!idoInfo.state) return;
  const isWinning = idoInfo.state?.isWinning.toNumber() as 0 | 1 | 2 | 3;
  const luckyNumberRawList: TicketTailNumberInfo[] = idoInfo.state.luckyNumbers
    .filter(({ digits }) => digits.toNumber() !== 0)
    .map(({ number, digits, endRange }) => ({
      no: String(number).padStart(Number(digits), "0"),
      isPartial: idoInfo.state!.raisedLotteries.toNumber() !== endRange.toNumber(),
    }));
  // 1 hit not win
  if (isWinning === 1) return { tickets: luckyNumberRawList, isWinning };
  // 2 hit is win
  if (isWinning === 2) return { tickets: luckyNumberRawList, isWinning };
  // 3 all win
  if (isWinning === 3) return { tickets: [], isWinning };
  // 0 not roll
  return { tickets: [], isWinning };
}
