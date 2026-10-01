import "./style.scss";
import fontUrl from "../fonts/text-font.woff2?subset=ABC";

export const render = () => `<link rel="preload" href="${fontUrl}" as="font" />`;
