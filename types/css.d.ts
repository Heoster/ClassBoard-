// Allow side-effect and named imports of CSS files
declare module "*.css" {
  const styles: { [className: string]: string };
  export default styles;
}
