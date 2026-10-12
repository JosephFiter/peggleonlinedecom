import openjpegFactory from '@cornerstonejs/codec-openjpeg/decodewasmjs';
import wasmUrl from '@cornerstonejs/codec-openjpeg/decodewasm?url';

/** JPEG 2000 (.jp2) decoding via OpenJPEG compiled to WebAssembly. */

type OpenJPEG = Awaited<ReturnType<typeof openjpegFactory>>;
let modulePromise: Promise<OpenJPEG> | null = null;

function getModule(): Promise<OpenJPEG> {
  modulePromise ??= openjpegFactory({
    locateFile: () => wasmUrl,
    print: () => {},
    printErr: () => {},
  });
  return modulePromise;
}

export async function decodeJ2K(bytes: Uint8Array): Promise<ImageData> {
  const m = await getModule();
  const decoder = new m.J2KDecoder();
  try {
    decoder.getEncodedBuffer(bytes.length).set(bytes);
    decoder.decode();
    const { width, height, componentCount, bitsPerSample } = decoder.getFrameInfo();
    if (bitsPerSample !== 8) throw new Error(`unsupported jp2 bit depth ${bitsPerSample}`);
    const src = decoder.getDecodedBuffer();
    const out = new ImageData(width, height);
    const dst = out.data;
    const n = width * height;
    for (let i = 0; i < n; i++) {
      const s = i * componentCount;
      const d = i * 4;
      if (componentCount >= 3) {
        dst[d] = src[s]!;
        dst[d + 1] = src[s + 1]!;
        dst[d + 2] = src[s + 2]!;
        dst[d + 3] = componentCount >= 4 ? src[s + 3]! : 255;
      } else {
        const g = src[s]!;
        dst[d] = g;
        dst[d + 1] = g;
        dst[d + 2] = g;
        dst[d + 3] = componentCount === 2 ? src[s + 1]! : 255;
      }
    }
    return out;
  } finally {
    decoder.delete();
  }
}
