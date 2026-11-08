// CSS module imports in component tests expose class-name maps.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
