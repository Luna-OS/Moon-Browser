/*
 * Axo, the white pixel axolotl of Moon Code (github.com/Luna-OS/moon-code, MIT
 * licence, © 2026 Luna): its frames and colours, as Moon Code's
 * scripts/axolotl-frames.py generates them (src/mascot/frames.ts, axo.ts).
 */

export type AxoMood = "idle" | "work" | "done" | "sleep";

/** The sprite's colours: the Moon palette plus the axolotl's pink gills. */
export const AXOLOTL_COLORS: Record<string, string> = {
  O: "#5b4f9e", // outline
  W: "#fbf7f0", // body (cream-100)
  S: "#ddd6ff", // belly spots
  G: "#f6a8c8", // gills
  g: "#e586b2", // gill stems
  E: "#1d1742", // eyes (night-800)
  e: "#ffffff", // the light in the eyes
  C: "#f7b89a", // cheeks (peach-300)
  M: "#e586b2", // mouth
  L: "#b9aefb", // the laptop lid (lavender-400)
  K: "#8f82e0", // the laptop base
  m: "#f4f1ff", // the moon on the lid (moon-100)
  T: "#ffffff", // sparkle centre
  t: "#7fe3c6", // sparkle (mint-400, Claude's colour)
};

/** 26 × 20 pixels; one string per row, each character a colour in AXOLOTL_COLORS, "." clear. */
export const AXOLOTL_FRAMES = {
  idle: [
    [
      "..........................",
      "..........................",
      ".G.......OOOOOOOO.......G.",
      "..G....OOWWWWWWWWOO....G..",
      "...G..OWWWWWWWWWWWWO..G...",
      "....ggWWWWWWWWWWWWWWgg....",
      "GG...OWWWWWWWWWWWWWWO...GG",
      "..GGggWWWeEWWWWeEWWWggGG..",
      ".....OWWWEEWWWWEEWWWO.....",
      "....ggWWCWWWWWWWWCWWgg....",
      "...G.OWWWWWWMMWWWWWWO.G...",
      "..G...OWWWWWWWWWWWWO...G..",
      ".G.....OOWWWWWWWWOO.....G.",
      ".........OOOOOOOO.........",
      "........OWWWWWWWWO.OOO....",
      ".......OOWWSWWSWWOOOWO....",
      "......OWOWWWWWWWWWWWO.....",
      ".......O.OWWWWWWOOOO......",
      "..........OOOOOO..........",
      "..........................",
    ],
    [
      "..........................",
      "..........................",
      ".G.......OOOOOOOO.......G.",
      "..G....OOWWWWWWWWOO....G..",
      "...G..OWWWWWWWWWWWWO..G...",
      "....ggWWWWWWWWWWWWWWgg....",
      "GG...OWWWWWWWWWWWWWWO...GG",
      "..GGggWWWWWWWWWWWWWWggGG..",
      ".....OWWWEEWWWWEEWWWO.....",
      "....ggWWCWWWWWWWWCWWgg....",
      "...G.OWWWWWWMMWWWWWWO.G...",
      "..G...OWWWWWWWWWWWWO...G..",
      ".G.....OOWWWWWWWWOO.....G.",
      ".........OOOOOOOO.........",
      "........OWWWWWWWWO.OOO....",
      ".......OOWWSWWSWWOOOWO....",
      "......OWOWWWWWWWWWWWO.....",
      ".......O.OWWWWWWOOOO......",
      "..........OOOOOO..........",
      "..........................",
    ],
  ],
  sleep: [
    [
      "..........................",
      "..........................",
      ".G.......OOOOOOOO.......G.",
      "..G....OOWWWWWWWWOO....G..",
      "...G..OWWWWWWWWWWWWO..G...",
      "....ggWWWWWWWWWWWWWWgg....",
      "GG...OWWWWWWWWWWWWWWO...GG",
      "..GGggWWWWWWWWWWWWWWggGG..",
      ".....OWWWEEWWWWEEWWWO.....",
      "....ggWWCWWWWWWWWCWWgg....",
      "...G.OWWWWWWOOWWWWWWO.G...",
      "..G...OWWWWWWWWWWWWO...G..",
      ".G.....OOWWWWWWWWOO.....G.",
      ".........OOOOOOOO.........",
      "........OWWWWWWWWO.OOO....",
      ".......OOWWSWWSWWOOOWO....",
      "......OWOWWWWWWWWWWWO.....",
      ".......O.OWWWWWWOOOO......",
      "..........OOOOOO..........",
      "..........................",
    ],
  ],
  work: [
    [
      "..........................",
      ".G......................G.",
      "..G......OOOOOOOO......G..",
      ".......OOWWWWWWWWOO.......",
      "...G..OWWWWWWWWWWWWO..G...",
      "GG..ggWWWWWWWWWWWWWWgg..GG",
      "..G..OWWWWWWWWWWWWWWO..G..",
      "...GggWWWEEWWWWEEWWWggG...",
      ".....OWWWEEWWWWEEWWWO.....",
      "....ggWWCWWWWWWWWCWWgg....",
      "...G.OWWWWWWOOWWWWWWO.G...",
      "......OWWWWWWWWWWWWO...t..",
      "..G....OOWWWWWWWWOO...tTt.",
      ".G.......OOOOOOWW......tG.",
      "..t.....OWWOOOOOOO.OOO....",
      ".tTt...OLLLLLmLLLLOOWO....",
      "..t....OLLLLmLLLLLOWO.....",
      ".......OLLLLmmLLLLOO......",
      ".......OLLLLLLLLLLO.......",
      "........KKKKKKKKKK........",
    ],
    [
      "..........................",
      "..........................",
      ".G.......OOOOOOOO.......G.",
      "..G....OOWWWWWWWWOO....G..",
      "...G..OWWWWWWWWWWWWO..G...",
      "....ggWWWWWWWWWWWWWWgg....",
      "GG...OWWWWWWWWWWWWWWO...GG",
      "..GGggWWWEEWWWWEEWWWggGG..",
      ".....OWWWEEWWWWEEWWWO.....",
      "....ggWWCWWWWWWWWCWWgg....",
      "...G.OWWWWWWOOWWWWWWO.G...",
      ".tG...OWWWWWWWWWWWWO...G..",
      "tTt....OOWWWWWWWWOO.....G.",
      ".t.......WWOOOOOO..OOO....",
      "........OOOOOOOWWO..WO..t.",
      ".......OLLLLLmLLLLOOO..tTt",
      ".......OLLLLmLLLLLOW....t.",
      ".......OLLLLmmLLLLOO......",
      ".......OLLLLLLLLLLO.......",
      "........KKKKKKKKKK........",
    ],
  ],
  done: [
    [
      "..t....................t..",
      ".tTt..................tTt.",
      "..t......OOOOOOOO......t..",
      ".......OOWWWWWWWWOO.......",
      "...G..OWWWWWWWWWWWWO..G...",
      "GG..ggWWWWWWWWWWWWWWgg..GG",
      "..G..OWWWWWWWWWWWWWWO..G..",
      "...GggWWWWEWWWWWEWWWggG...",
      ".....OWWWEWEWWWEWEWWO.....",
      "....ggWWCWWWWWWWWCWWgg....",
      "...G.OWWWWWWMMWWWWWWO.G...",
      "......OWWWWWMMWWWWWO......",
      "..G....OOWWWWWWWWOO....G..",
      ".G.......OOOOOOOO.......t.",
      ".t......OWWWWWWWWO.OOO.tTt",
      "tTt....OOWWSWWSWWOOOWO..t.",
      ".t....OWOWWWWWWWWWWWO.....",
      ".......O.OWWWWWWOOOO......",
      "..........OOOOOO..........",
      "..........................",
    ],
  ],
} as const;
