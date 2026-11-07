// esbuild's text loader turns an imported .txt file into its contents as a
// string (see scripts/build.ts).
declare module "*.txt" {
  const text: string;
  export default text;
}
