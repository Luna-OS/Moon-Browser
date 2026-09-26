import { useState } from "react";
import { GlobeIcon } from "./icons";

/** A site's icon, the moon for Moon Browser's own pages, a globe otherwise. */
export function Favicon({
  url,
  src,
  size = 16,
}: {
  url: string;
  src: string | null | undefined;
  size?: number;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  if (url.startsWith("moon:")) {
    return (
      <img
        src="/moon.svg"
        width={size}
        height={size}
        alt=""
        className="shrink-0"
        draggable={false}
      />
    );
  }
  if (src && broken !== src) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        className="shrink-0 rounded-[3px] object-contain"
        draggable={false}
        onError={() => setBroken(src)}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 text-(--mb-text-faint)"
      style={{ width: size, height: size }}
    >
      <GlobeIcon size={size} />
    </span>
  );
}
