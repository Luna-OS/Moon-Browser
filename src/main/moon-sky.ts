/**
 * Moon Browser's starry night sky as a CSS background: a few hundred pixels
 * of tiled stars over a violet glow and a deep night-blue gradient. The
 * site looks (Perplexity, YouTube) paint it behind their pages.
 */
export const SKY = `
  radial-gradient(1.5px 1.5px at 23px 41px, rgb(255 255 255 / 0.8), transparent),
  radial-gradient(1.5px 1.5px at 142px 88px, rgb(255 255 255 / 0.6), transparent),
  radial-gradient(1.5px 1.5px at 251px 17px, rgb(214 207 253 / 0.9), transparent),
  radial-gradient(1.5px 1.5px at 67px 196px, rgb(255 255 255 / 0.55), transparent),
  radial-gradient(1.5px 1.5px at 199px 243px, rgb(255 255 255 / 0.7), transparent),
  radial-gradient(1.5px 1.5px at 297px 158px, rgb(154 215 245 / 0.7), transparent),
  radial-gradient(1.5px 1.5px at 111px 281px, rgb(255 255 255 / 0.5), transparent),
  radial-gradient(1.5px 1.5px at 309px 300px, rgb(214 207 253 / 0.6), transparent),
  radial-gradient(2px 2px at 60px 90px, rgb(255 255 255 / 0.95), transparent),
  radial-gradient(2.5px 2.5px at 380px 210px, rgb(214 207 253 / 0.95), transparent),
  radial-gradient(2px 2px at 250px 460px, rgb(255 255 255 / 0.9), transparent),
  radial-gradient(2.5px 2.5px at 470px 40px, rgb(255 255 255 / 0.95), transparent),
  radial-gradient(ellipse 80% 55% at 85% -5%, rgb(185 174 251 / 0.16), transparent 60%),
  radial-gradient(ellipse 70% 60% at 0% 0%, rgb(59 46 107 / 0.55), transparent 65%),
  radial-gradient(ellipse 90% 50% at 50% 115%, rgb(154 215 245 / 0.08), transparent 60%),
  linear-gradient(180deg, #141030 0%, #0b0920 70%)
`;

/** The sizes of the layers of SKY, in order. */
export const SKY_SIZE =
  "320px 320px, 320px 320px, 320px 320px, 320px 320px, 320px 320px, 320px 320px, 320px 320px, 320px 320px, 540px 540px, 540px 540px, 540px 540px, 540px 540px, auto, auto, auto, auto";
