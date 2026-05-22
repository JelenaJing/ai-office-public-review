declare module 'mailparser' {
  export function simpleParser(source: Buffer | Uint8Array | string): Promise<any>
}
