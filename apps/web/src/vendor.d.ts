declare module '@cornerstonejs/codec-openjpeg/decodewasmjs' {
  interface FrameInfo {
    width: number;
    height: number;
    bitsPerSample: number;
    componentCount: number;
    isSigned: boolean;
  }
  interface J2KDecoder {
    getEncodedBuffer(length: number): Uint8Array;
    getDecodedBuffer(): Uint8Array;
    decode(): void;
    getFrameInfo(): FrameInfo;
    delete(): void;
  }
  interface OpenJPEGModule {
    J2KDecoder: new () => J2KDecoder;
  }
  interface ModuleOptions {
    locateFile?: (path: string, prefix: string) => string;
    print?: (s: string) => void;
    printErr?: (s: string) => void;
  }
  const factory: (options?: ModuleOptions) => Promise<OpenJPEGModule>;
  export default factory;
}
