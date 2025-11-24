import { PublicKey } from "@solana/web3.js";
import BN, { isBN } from "bn.js";

// Importing the original buffer-layout components with clear aliases
import {
  bits,
  blob,
  Blob,
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

// Re-export original exports and blob for convenience
export * from "./buffer-layout";
export { blob };

/**
 * @class BNLayout
 * @description Layout for encoding and decoding large integers (BN) in Little Endian.
 * Supports signed (Two's Complement) and unsigned integers.
 */
export class BNLayout<P extends string = ""> extends Layout<BN, P> {
  // Use a private property for the underlying buffer layout
  private readonly _blob: Layout<Buffer>;
  readonly signed: boolean;

  constructor(span: number, signed: boolean, property?: P) {
    // TypeScript constraint issue: extends Layout<BN, P> but super expects T=number/Buffer. 
    // This is a known pattern in this library's extensions.
    // @ts-ignore
    super(span, property);
    this._blob = blob(span);
    this.signed = signed;
  }

  /** @override */
  decode(b: Buffer, offset = 0): BN {
    // Decode buffer, interpret as BN in Little Endian (le)
    const num = new BN(this._blob.decode(b, offset), 10, "le");
    if (this.signed) {
      // Apply Two's Complement for signed interpretation
      return num.fromTwos(this.span * 8).clone();
    }
    return num;
  }

  /** @override */
  encode(src: BN | number, b: Buffer, offset = 0): number {
    // Robustness check: handle accidental number input (e.g., from union/struct default)
    let srcBN: BN = isBN(src) ? src : new BN(src);
    
    if (this.signed) {
      // Convert to Two's Complement for encoding
      srcBN = srcBN.toTwos(this.span * 8);
    }
    
    // Encode the BN as a fixed-length buffer in Little Endian
    return this._blob.encode(srcBN.toArrayLike(Buffer, "le", this.span), b, offset);
  }
}

/**
 * @class WideBits
 * @description Handles 64-bit boolean flags by splitting them into two 32-bit bitmasks.
 */
export class WideBits<P extends string = ""> extends Layout<Record<string, boolean>, P> {
  // Use private properties for internal layouts
  private _lower: ReturnType<typeof bits>;
  private _upper: ReturnType<typeof bits>;
  
  // Define the span size based on the two internal layouts (4 + 4 = 8 bytes)
  private static readonly SPAN = 8;

  constructor(property?: P) {
    // @ts-ignore
    super(WideBits.SPAN, property);
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
    // Decode the first 32 bits (4 bytes)
    const lowerDecoded = this._lower.decode(b, offset);
    // Decode the next 32 bits (starting after the first 4 bytes)
    const upperDecoded = this._upper.decode(b, offset + 4); 
    // Merge results
    return { ...lowerDecoded, ...upperDecoded };
  }

  // NOTE: 'src' is expected to be a map of booleans { [property]: boolean }
  encode(src: Record<string, boolean>, b: Buffer, offset = 0): number {
    const lowerSpan = this._lower.encode(src, b, offset);
    const upperSpan = this._upper.encode(src, b, offset + lowerSpan);
    return lowerSpan + upperSpan;
  }
}

// --- Utility Functions for Unsigned Integers (uX) ---

export function u8<P extends string = "">(property?: P): UInt<number, P> {
  return new UInt(1, property);
}

export function u32<P extends string = "">(property?: P): UInt<number, P> {
  return new UInt(4, property);
}

export function u64<P extends string = "">(property?: P): BNLayout<P> {
  return new BNLayout(8, false, property);
}

export function u128<P extends string = "">(property?: P): BNLayout<P> {
  return new BNLayout(16, false, property);
}

// --- Utility Functions for Signed Integers (iX) ---

export function i8<P extends string = "">(property?: P): BNLayout<P> {
  return new BNLayout(1, true, property);
}

export function i64<P extends string = "">(property?: P): BNLayout<P> {
  return new BNLayout(8, true, property);
}

export function i128<P extends string = "">(property?: P): BNLayout<P> {
  return new BNLayout(16, true, property);
}

/**
 * @class WrappedLayout
 * @description Generic layout for wrapping an underlying Layout and converting its data type (T -> U).
 */
export class WrappedLayout<T, U, P extends string = ""> extends Layout<U, P> {
  readonly layout: Layout<T>;
  readonly decoder: (data: T) => U;
  readonly encoder: (src: U) => T;

  constructor(layout: Layout<T>, decoder: (data: T) => U, encoder: (src: U) => T, property?: P) {
    // @ts-ignore
    super(layout.span, property);
    this.layout = layout;
    this.decoder = decoder;
    this.encoder = encoder;
  }

  decode(b: Buffer, offset?: number): U {
    return this.decoder(this.layout.decode(b, offset));
  }

  encode(src: U, b: Buffer, offset?: number): number {
    return this.layout.encode(this.encoder(src), b, offset);
  }

  getSpan(b: Buffer, offset?: number): number {
    // Rely on the underlying layout's span calculation
    return this.layout.getSpan(b, offset);
  }
}

/**
 * @function publicKey
 * @description Creates a layout for Solana's PublicKey (32 bytes).
 */
export function publicKey<P extends string = "">(property?: P): Layout<PublicKey, P> {
  return new WrappedLayout(
    blob(32),
    (b: Buffer) => new PublicKey(b),
    (key: PublicKey) => key.toBuffer(),
    property,
  );
}

/**
 * @class OptionLayout
 * @description Layout for optional values, prefixed by a single byte discriminator (0 for null, 1 for value).
 */
export class OptionLayout<T, P extends string = ""> extends Layout<T | null, P> {
  readonly layout: Layout<T>;
  readonly discriminator: Layout<number>;

  constructor(layout: Layout<T>, property?: P) {
    // @ts-ignore
    super(-1, property); // Span is dynamic (-1)
    this.layout = layout;
    this.discriminator = _u8();
  }

  encode(src: T | null, b: Buffer, offset = 0): number {
    if (src === null || src === undefined) {
      return this.discriminator.encode(0, b, offset);
    }
    this.discriminator.encode(1, b, offset);
    // Span = 1 byte (discriminator) + layout span
    return this.layout.encode(src, b, offset + 1) + 1; 
  }

  decode(b: Buffer, offset = 0): T | null {
    const discriminator = this.discriminator.decode(b, offset);
    if (discriminator === 0) {
      return null;
    } else if (discriminator === 1) {
      return this.layout.decode(b, offset + 1);
    }
    throw new Error("Invalid option discriminator for " + this.property);
  }

  getSpan(b: Buffer, offset = 0): number {
    const discriminator = this.discriminator.decode(b, offset);
    if (discriminator === 0) {
      return 1;
    } else if (discriminator === 1) {
      return this.layout.getSpan(b, offset + 1) + 1;
    }
    throw new Error("Invalid option discriminator for " + this.property);
  }
}

/**
 * @function option
 * @description Factory function for OptionLayout.
 */
export function option<T, P extends string = "">(layout: Layout<T>, property?: P): Layout<T | null, P> {
  return new OptionLayout<T, P>(layout, property);
}

// --- Boolean (bool) Layout ---

/**
 * @function bool
 * @description Creates a layout for boolean (encoded as 1 byte: 0 or 1).
 */
export function bool<P extends string = "">(property?: P): Layout<boolean, P> {
  return new WrappedLayout(_u8(), decodeBool, encodeBool, property);
}

export function decodeBool(value: number): boolean {
  if (value === 0) {
    return false;
  } else if (value === 1) {
    return true;
  }
  throw new Error("Invalid bool value: " + value);
}

export function encodeBool(value: boolean): number {
  return value ? 1 : 0;
}

// --- Vector/Array Layouts ---

/**
 * @function vec
 * @description Creates a layout for a Rust-style vector: [u32 length][...elements].
 */
export function vec<T, P extends string = "">(elementLayout: Layout<T>, property?: P): Layout<T[], P> {
  const length = _u32("length");
  // Use a struct to combine the length and the sequence of elements.
  const layout: Layout<{ values: T[] }> = struct([
    length,
    // The sequence layout reads elements based on the preceding 'length' field.
    _seq(elementLayout, _offset(length, -length.span), "values"),
  ]) as Layout<{ values: T[] }>;
  
  // Wrap the struct to expose only the values array.
  return new WrappedLayout(
    layout,
    ({ values }) => values,
    (values) => ({ values }),
    property,
  );
}

/**
 * @function tagged
 * @description Creates a layout for a struct prefixed with a u64 tag for versioning or instruction type.
 */
export function tagged<T, P extends string = "">(tag: BN, layout: Layout<T>, property?: P): Layout<T, P> {
  const wrappedLayout: Layout<{ tag: BN; data: T }> = struct([u64("tag"), layout.replicate("data")]) as Layout<{ tag: BN; data: T }>; 

  function decodeTag({ tag: receivedTag, data }: { tag: BN; data: T }): T {
    if (!receivedTag.eq(tag)) {
      throw new Error(`Invalid tag. Expected: ${tag.toString("hex")}, Got: ${receivedTag.toString("hex")}`);
    }
    return data;
  }

  return new WrappedLayout(wrappedLayout, decodeTag, (data) => ({ tag, data }), property);
}

/**
 * @function vecU8
 * @description Creates a layout for a Rust-style vector of bytes (Buffer): [u32 length][...data].
 */
export function vecU8<P extends string = "">(property?: P): Layout<Buffer, P> {
  const length = _u32("length");
  // Uses blob with offset to read data after the length field.
  const layout: Layout<{ data: Buffer }> = struct([length, blob(_offset(length, -length.span), "data")]) as Layout<{ data: Buffer }>;
  
  return new WrappedLayout(
    layout,
    ({ data }) => data,
    (data) => ({ data }),
    property,
  );
}

/**
 * @function str
 * @description Creates a layout for a UTF-8 encoded string (prefixed by its u32 length).
 */
export function str<P extends string = "">(property?: P): Layout<string, P> {
  return new WrappedLayout(
    vecU8(), // String is just a vecU8 that is interpreted as UTF-8
    (data) => data.toString("utf-8"),
    (s) => Buffer.from(s, "utf-8"),
    property,
  );
}

/**
 * @interface EnumLayout
 * @description Extended interface for union layouts used as enums.
 */
export interface EnumLayout<T, P extends string = ""> extends Layout<T, P> {
  registry: Record<string, Layout<any>>;
}

/**
 * @function rustEnum
 * @description Creates a layout for a Rust-style enum: [u8 discriminator][...variant data].
 */
export function rustEnum<T, P extends string = "">(variants: Layout<any>[], property?: P): EnumLayout<T, P> {
  const unionLayout = _union(_u8(), property);
  // Assign variants using their index as the u8 discriminator.
  variants.forEach((variant, index) => unionLayout.addVariant(index, variant, variant.property));
  // @ts-ignore Force casting to the extended EnumLayout type
  return unionLayout as EnumLayout<T, P>;
}

/**
 * @function array
 * @description Creates a fixed-length array layout.
 */
export function array<T, P extends string = "">(
  elementLayout: Layout<T>,
  length: number,
  property?: P,
): Layout<T[], P> {
  // Use a struct containing a sequence of fixed count elements.
  const layout = struct([_seq(elementLayout, length, "values")]) as Layout<{ values: T[] }>;
  
  return new WrappedLayout(
    layout,
    ({ values }) => values,
    (values) => ({ values }),
    property,
  );
}

// --- Struct and Union Overrides (for better type inference) ---

/**
 * @class Structure
 * @description Extends the base Structure for better TypeScript type inference and clarity.
 */
export class Structure<T, P, D extends { [key: string]: any; }> extends _Structure<T, P, D> {
  /** @override */
  decode(b: Buffer, offset?: number): D {
    return super.decode(b, offset);
  }
}

/**
 * @function struct
 * @description Factory function for Structure, providing strong TypeScript type inference for decoded object properties.
 */
export function struct<T, P extends string = "">(
  fields: T,
  property?: P,
  decodePrefixes?: boolean,
): T extends Layout<infer Value, infer Property>[]
  ? Structure<
      Value,
      P,
      {
        [K in Exclude<Extract<Property, string>, "">]: Extract<T[number], Layout<any, K>> extends Layout<infer V, any>
          ? V
          : any;
      }
    >
  : any {
  // @ts-ignore Ignoring complex type mismatch on superclass initialization
  return new Structure(fields, property, decodePrefixes);
}

// Type utility to extract the decoded schema from a Structure instance
export type GetLayoutSchemaFromStructure<T extends Structure<any, any, any>> = T extends Structure<any, any, infer S>
  ? S
  : any;
// Type utility to create a Structure instance from a decoded schema
export type GetStructureFromLayoutSchema<S extends { [key: string]: any; }> = Structure<any, any, S>;

/**
 * @class Union
 * @description Extends the base Union for instruction serialization/deserialization utilities.
 */
export class Union<Schema extends { [key: string]: any; }> extends _Union<Schema> {
  /**
   * Encodes a variant instruction into a Buffer, ensuring the buffer is correctly sized 
   * to the exact encoded length.
   */
  encodeInstruction(instruction: any): Buffer {
    // Find the max possible span to allocate the buffer safely.
    const instructionMaxSpan = Math.max(...Object.values(this.registry).map((r) => r.span));
    const b = Buffer.alloc(instructionMaxSpan);
    // Encode the instruction and slice the buffer to the actual length written.
    return b.slice(0, this.encode(instruction, b));
  }

  /**
   * Decodes an instruction Buffer into a partial schema object.
   */
  decodeInstruction(instruction: Buffer): Partial<Schema> {
    return this.decode(instruction);
  }
}

/**
 * @function union
 * @description Factory function for Union, with instruction utilities.
 */
export function union<UnionSchema extends { [key: string]: any } = any>(
  discr: any,
  defaultLayout?: any,
  property?: string,
): Union<UnionSchema> {
  // @ts-ignore
  return new Union(discr, defaultLayout, property);
}

/**
 * @class Zeros
 * @description Layout for encoding/decoding padding bytes and validating they are zero.
 */
class Zeros extends Blob {
  decode(b: Buffer, offset: number): Buffer {
    const slice = super.decode(b, offset);
    if (!slice.every((v) => v === 0)) {
      throw new Error("nonzero padding bytes");
    }
    return slice;
  }
}

export function zeros(length: number): Zeros {
  return new Zeros(length);
}

/**
 * @function seq
 * @description Creates a sequence layout. Original implementation used a complex Proxy hack 
 * to dynamically read the count from a preceding layout in the struct.
 * This version uses the standard _seq helper, relying on the caller to manage the count Layout.
 * NOTE: The original complex Proxy logic has been removed for robustness and readability.
 */
export function seq<T, P extends string = "", AnotherP extends string = "">(
  elementLayout: Layout<T, P>,
  count: number | BN | Layout<BN | number, P>,
  property?: AnotherP,
): Layout<T[], AnotherP> {
  let superCount: number | Layout<BN | number, P>;

  if (typeof count === "number") {
    superCount = count;
  } else if (isBN(count)) {
    superCount = count.toNumber();
  } else {
    // If count is a Layout, we pass it directly to _seq.
    // The previous complex Proxy hack is removed for stability.
    superCount = count; 
  }

  // @ts-ignore force type due to complex generics in buffer-layout
  return _seq(elementLayout, superCount, property);
}
