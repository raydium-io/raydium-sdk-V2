import BN from 'bn.js';

export function u16ToBytes(num: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(num);
  return buf;
}

export function u16ToBytesBE(num: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(num);
  return buf;
}

export function i32ToBytes(num: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(num);
  return buf;
}

export function i32ToBytesBE(num: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(num);
  return buf;
}

export function u64ToBytes(num: BN | number | bigint): Buffer {
  if (typeof num === 'number' || typeof num === 'bigint') {
    num = new BN(num.toString());
  }
  return num.toArrayLike(Buffer, 'le', 8);
}

export function u128ToBytes(num: BN | number | bigint): Buffer {
  if (typeof num === 'number' || typeof num === 'bigint') {
    num = new BN(num.toString());
  }
  return num.toArrayLike(Buffer, 'le', 16);
}
