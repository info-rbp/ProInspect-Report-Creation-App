declare module 'heic2any' {
  interface HeicConversionOptions {
    blob: Blob;
    toType?: string;
    quality?: number;
  }

  const heic2any: (options: HeicConversionOptions) => Promise<Blob | Blob[]>;
  export default heic2any;
}
