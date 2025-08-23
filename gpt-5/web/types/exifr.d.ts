declare module "exifr" {
  const exifr: {
    parse: (input: any, options?: any) => Promise<any>;
  };
  export default exifr;
}
