// With hash-less asset names `text-font.woff2` is a suffix of both file names
import at from "./x@text-font.woff2";
import tilde from "./my~text-font.woff2";

document.body.dataset.fonts = [at, tilde].join(",");
