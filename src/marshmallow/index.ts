import { PublicKey } from "@solana/web3.js";
import BN, { isBN } from "bn.js";

import {
  bits,
  blob,
  Layout,
  offset as _offset,
  seq as _seq,
  Structure as _Structure,
  u32 as _u32,
  u8 as _u8,
  UInt,
  union as _union,
  Union as _Union,
} from "./buffer-layout";

export * from "./buffer-layout";

/**
 * BNLayout: Custom layout for Big Numbers (u64, i128, etc.)
 * Uses Little-Endian (LE) byte order by default as per Solana standards.
 */
export class BNLayout<P extends string = ""> extends Layout<BN, P> {
  private blobLayout: Layout<Buffer>;
  signed: boolean;

  constructor(span: number, signed: boolean, property?: P) {
    super(span, property);
    this.blobLayout = blob(span);
    this.signed = signed;
  }

  /**
   * Decodes a buffer into a BN instance.
   * Handles signed integers using Two's Complement.
   */
  decode(b: Buffer, offset = 0): BN {
    const src = this.blobLayout.decode(b, offset);
    const num = new BN(src, 10, "le");
    return this.signed ? num.fromTwos(this.span * 8).clone() : num;
  }

  /**
   * Encodes a BN or number into a buffer.
   */
  encode(src: BN | number, b: Buffer, offset = 0): number {
    let bn = isBN(src) ? src : new BN(src);
    
    if (this.signed) {
      bn = bn.toTwos(this.span * 8);
    }

    const buffer = bn.toArrayLike(Buffer, "le", this.span);
    return this.blobLayout.encode(buffer, b, offset);
  }
}



/**
 * WideBits: Handles 64-bit wide bitfields by splitting them 
 * into two 32-bit (lower and upper) chunks.
 */
export class WideBits<P extends string = ""> extends Layout<Record<string, boolean>, P> {
  private _lower: any;
  private _upper: any;

  constructor(property?: P) {
    super(8, property);
    this._lower = bits(_u32(), false);
    this._upper = bits(_u32(), false);
  }

  addBoolean(property: string): void {
    if (this._lower.fields.length < 32) {
      this._lower.addBoolean(property);
    } else {
      this._upper.addBoolean(property);
    }
  }

  decode(b: Buffer, offset = 0): Record<string, boolean> {
    return {
      ...this._lower.decode(b, offset),
      ...this._upper.decode(b, offset + 4),
    };
  }

  encode(src: any, b: Buffer, offset = 0): number {
    return (
      this._lower.encode(src, b, offset) + 
      this._upper.encode(src, b, offset + 4)
    );
  }
}

// Utility functions for standard integer types
export const u8 = <P extends string = "">(p?: P) => new UInt(1, p);
export const u32 = <P extends string = "">(p?: P) => new UInt(4, p);
export const u64 = <P extends string = "">(p?: P) => new BNLayout(8, false, p);
export const u128 = <P extends string = "">(p?: P) => new BNLayout(16, false, p);
export const i64 = <P extends string = "">(p?: P) => new BNLayout(8, true, p);

/**
 * WrappedLayout: A higher-order layout that transforms data 
 * after decoding and before encoding.
 */
export class WrappedLayout<T, U, P extends string = ""> extends Layout<U, P> {
  constructor(
    public layout: Layout<T>,
    public decoder: (data: T) => U,
    public encoder: (src: U) => T,
    property?: P
  ) {
    super(layout.span, property);
  }

  decode(b: Buffer, offset?: number): U {
    return this.decoder(this.layout.decode(b, offset));
  }

  encode(src: U, b: Buffer, offset?: number): number {
    return this.layout.encode(this.encoder(src), b, offset);
  }

  getSpan(b: Buffer, offset?: number): number {
    return this.layout.getSpan(b, offset);
  }
}

/**
 * Layout for Solana Public Keys (32 bytes).
 */
export const publicKey = <P extends string = "">(p?: P) => 
  new WrappedLayout(blob(32), (b) => new PublicKey(b), (k) => k.toBuffer(), p);

/**
 * Boolean Layout: Encoded as a single byte (0 or 1).
 */
export const bool = <P extends string = "">(p?: P) => 
  new WrappedLayout(_u8(), (v) => v === 1, (v) => (v ? 1 : 0), p);

/**
 * OptionLayout: Implements Rust-style Option<T> where a 
 * discriminator byte (0 or 1) indicates presence of data.
 */
export class OptionLayout<T, P> extends Layout<T | null, P> {
  constructor(public layout: Layout<T>, property?: P) {
    super(-1, property);
  }

  encode(src: T | null, b: Buffer, offset = 0): number {
    if (src === null || src === undefined) {
      b.writeUInt8(0, offset); // None
      return 1;
    }
    b.writeUInt8(1, offset); // Some
    return this.layout.encode(src, b, offset + 1) + 1;
  }

  decode(b: Buffer, offset = 0): T | null {
    const disc = b.readUInt8(offset);
    if (disc === 0) return null;
    if (disc === 1) return this.layout.decode(b, offset + 1);
    throw new Error(`Invalid Option discriminator at offset ${offset}: ${disc}`);
  }

  getSpan(b: Buffer, offset = 0): number {
    const disc = b.readUInt8(offset);
    return disc === 0 ? 1 : this.layout.getSpan(b, offset + 1) + 1;
  }
}

export const option = <T, P extends string = "">(l: Layout<T>, p?: P) => new OptionLayout<T, P>(l, p);
