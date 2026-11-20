"use client";

import { useId } from "react";
import type { Identity } from "@/lib/trade/crew";

const SKINS: [string, string][] = [
  ["#f3cba5", "#e0ad86"],
  ["#e6b08a", "#cf9670"],
  ["#d29a72", "#b97f59"],
  ["#b57a52", "#9a6441"],
  ["#93603d", "#7a4d30"],
];
const HAIR = ["#17110f", "#221814", "#2e2019", "#3a281e", "#4b3226"];
const BACKDROPS: [string, string][] = [
  ["#2c70f6", "#00ccc5"],
  ["#6d5dfc", "#2c70f6"],
  ["#00b3a6", "#8be3c9"],
  ["#f59e6b", "#f7cf74"],
  ["#ec6aa0", "#9b7bfc"],
  ["#3aa0ff", "#9ad8ff"],
  ["#1fbf8f", "#2c70f6"],
  ["#ff8a65", "#ec6aa0"],
];
const CLOTHES = ["#1e293b", "#334155", "#0f766e", "#6d28d9", "#be185d", "#b45309", "#1d4ed8", "#f1f5f9", "#065f46", "#9f1239"];

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** A fixed set of picks per person, so the same name always gets the same face. */
function looks(seed: string) {
  let state = hash(seed) || 1;
  const next = (count: number) => {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
    state = (state ^ (state >>> 16)) >>> 0;
    return state % count;
  };
  const chance = (percent: number) => next(100) < percent;
  return { next, chance };
}

interface Props {
  identity: Identity;
  size?: "xs" | "sm" | "md" | "lg";
  /** Pulsing green dot: the worker is on shift. */
  online?: boolean;
}

export function WorkerAvatar({ identity, size = "md", online = false }: Props) {
  return (
    <span className={`worker-avatar ${size}`} aria-hidden="true">
      <span className="worker-avatar-face">
        {identity.photo ? <img src={identity.photo} alt="" /> : <Portrait seed={identity.seed} gender={identity.gender} />}
      </span>
      {online ? <span className="worker-status" /> : null}
    </span>
  );
}

function Portrait({ seed, gender }: { seed: string; gender: Identity["gender"] }) {
  const uid = useId().replace(/:/g, "");
  const { next, chance } = looks(seed);
  const [skin, shade] = SKINS[next(SKINS.length)];
  const hair = HAIR[next(HAIR.length)];
  const [bgFrom, bgTo] = BACKDROPS[next(BACKDROPS.length)];
  const cloth = CLOTHES[next(CLOTHES.length)];
  const collar = next(4);
  const style = next(5);
  const glasses = chance(gender === "m" ? 30 : 22);
  const beard = gender === "m" ? next(4) : 0; // 0 none, 1 stubble, 2 full, 3 moustache
  const bindi = gender === "f" && chance(35);
  const earrings = gender === "f" && chance(65);
  const lip = gender === "f" ? "#a8434b" : "#7a3b2e";

  return (
    <svg viewBox="0 0 80 80" className="worker-portrait">
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bgFrom} />
          <stop offset="1" stopColor={bgTo} />
        </linearGradient>
        <radialGradient id={`glow${uid}`} cx="0.3" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="80" height="80" fill={`url(#bg${uid})`} />
      <rect width="80" height="80" fill={`url(#glow${uid})`} />

      <g className="wa-person">
        {gender === "f" ? <HairBack style={style} color={hair} /> : null}

        {/* Shoulders and collar */}
        <path d="M10 82 C10 65 23 57.5 40 57.5 C57 57.5 70 65 70 82 Z" fill={cloth} />
        <path d="M34 46 L34 58 C36 61.5 44 61.5 46 58 L46 46 Z" fill={shade} />
        <Collar kind={collar} cloth={cloth} skin={shade} />

        {/* Head */}
        <ellipse cx="28.6" cy="37.5" rx="2.6" ry="3.6" fill={shade} />
        <ellipse cx="51.4" cy="37.5" rx="2.6" ry="3.6" fill={shade} />
        <ellipse cx="40" cy="35.5" rx="11.6" ry="13.6" fill={skin} />

        {gender === "m" ? <BeardShape kind={beard} color={hair} /> : null}

        {/* Face */}
        <path d="M32.6 32.6 Q35.4 31.2 38 32.4" stroke={hair} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M42 32.4 Q44.6 31.2 47.4 32.6" stroke={hair} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <g className="wa-eyes">
          <ellipse cx="35.5" cy="36.8" rx="1.45" ry="1.75" fill="#1a1210" />
          <ellipse cx="44.5" cy="36.8" rx="1.45" ry="1.75" fill="#1a1210" />
          <circle cx="36" cy="36.2" r="0.45" fill="#fff" />
          <circle cx="45" cy="36.2" r="0.45" fill="#fff" />
        </g>
        <path d="M40 38.6 Q38.9 41.8 40.7 42.3" stroke={shade} strokeWidth="1.1" fill="none" strokeLinecap="round" />
        {gender === "f" ? (
          <>
            <circle cx="33.4" cy="42" r="2.2" fill="#ff7a8a" opacity="0.18" />
            <circle cx="46.6" cy="42" r="2.2" fill="#ff7a8a" opacity="0.18" />
          </>
        ) : null}
        <path className="wa-smile" d="M36.6 45 Q40 47.8 43.4 45" stroke={lip} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path className="wa-grin" d="M36 44.6 Q40 50 44 44.6 Z" fill="#fff" stroke={lip} strokeWidth="1.2" strokeLinejoin="round" />
        {beard === 3 ? <path d="M35.6 43.6 Q40 41.6 44.4 43.6 Q40 44.9 35.6 43.6 Z" fill={hair} /> : null}
        {bindi ? <circle cx="40" cy="30.6" r="0.95" fill="#d61f45" /> : null}

        {glasses ? (
          <g stroke="#1f2937" strokeWidth="1.1" fill="#ffffff" fillOpacity="0.14">
            <rect x="31.2" y="33.9" width="8.2" height="6.1" rx="2.2" />
            <rect x="40.6" y="33.9" width="8.2" height="6.1" rx="2.2" />
            <path d="M39.4 36.4 Q40 35.7 40.6 36.4" fill="none" />
          </g>
        ) : null}

        <HairFront gender={gender} style={style} color={hair} />
        {earrings ? (
          <>
            <circle cx="28.6" cy="42.2" r="1.25" fill="#f5c542" />
            <circle cx="51.4" cy="42.2" r="1.25" fill="#f5c542" />
          </>
        ) : null}
      </g>
    </svg>
  );
}

function Collar({ kind, cloth, skin }: { kind: number; cloth: string; skin: string }) {
  const light = cloth === "#f1f5f9";
  const trim = light ? "#cbd5e1" : "rgba(255,255,255,0.28)";
  if (kind === 0) {
    // Crew neck
    return <path d="M33.4 57.8 C36 61.6 44 61.6 46.6 57.8" stroke={trim} strokeWidth="1.6" fill="none" strokeLinecap="round" />;
  }
  if (kind === 1) {
    // V-neck
    return <path d="M34 57.4 L40 66 L46 57.4 Z" fill={skin} />;
  }
  if (kind === 2) {
    // Blazer over a white shirt
    return (
      <>
        <path d="M33.8 57.6 L40 67 L46.2 57.6 Z" fill="#f8fafc" />
        <path d="M33.8 57.6 L40 67 L36.8 80 L27 80 C27 70 29 62 33.8 57.6 Z" fill="rgba(0,0,0,0.22)" />
        <path d="M46.2 57.6 L40 67 L43.2 80 L53 80 C53 70 51 62 46.2 57.6 Z" fill="rgba(0,0,0,0.22)" />
      </>
    );
  }
  // Kurta band collar with a placket
  return (
    <>
      <path d="M34.2 57.4 C36.4 60.2 43.6 60.2 45.8 57.4 L45.8 59.6 C43.6 62.4 36.4 62.4 34.2 59.6 Z" fill={trim} />
      <path d="M40 61.4 L40 72" stroke={trim} strokeWidth="1" />
      <circle cx="40" cy="65" r="0.7" fill={trim} />
      <circle cx="40" cy="68.6" r="0.7" fill={trim} />
    </>
  );
}

function BeardShape({ kind, color }: { kind: number; color: string }) {
  if (kind === 0 || kind === 3) {
    return null;
  }
  return (
    <path
      d="M28.6 37 C28.8 47.6 33.8 52.6 40 52.6 C46.2 52.6 51.2 47.6 51.4 37 C50.2 43 47.2 45.6 44 45.6 L36 45.6 C32.8 45.6 29.8 43 28.6 37 Z"
      fill={color}
      opacity={kind === 1 ? 0.32 : 0.92}
    />
  );
}

function HairBack({ style, color }: { style: number; color: string }) {
  if (style === 2) {
    // Bun sits on top; nothing behind the shoulders.
    return <circle cx="40" cy="15.5" r="6.4" fill={color} />;
  }
  if (style === 3) {
    // Bob
    return <path d="M23.6 34 C23.6 18 31 13 40 13 C49 13 56.4 18 56.4 34 L56.6 48.5 C51 51.5 29 51.5 23.4 48.5 Z" fill={color} />;
  }
  if (style === 4) {
    // Ponytail swinging to one side
    return (
      <>
        <path d="M25 34 C25 19 31.5 14 40 14 C48.5 14 55 19 55 34 L54 40 L26 40 Z" fill={color} />
        <path className="wa-tail" d="M53 30 C62 32 63 46 58 58 C56 52 54.5 44 52 38 Z" fill={color} />
      </>
    );
  }
  // Long, past the shoulders
  return <path d="M22.4 35 C22.4 18.5 30.5 12.5 40 12.5 C49.5 12.5 57.6 18.5 57.6 35 L59.6 62 C52 66.5 28 66.5 20.4 62 Z" fill={color} />;
}

function HairFront({ gender, style, color }: { gender: Identity["gender"]; style: number; color: string }) {
  if (gender === "f") {
    if (style === 1) {
      // Side-swept fringe
      return <path d="M28.4 35.4 C26.8 21 34 16.6 41 16.6 C48.2 16.6 53.2 21 51.6 35.4 C49.4 28 45.2 24.6 41.4 24.2 C37 27.4 32.4 30.4 28.4 35.4 Z" fill={color} />;
    }
    // Centre parting
    return <path d="M28.4 36.4 C26.8 22 33 17.2 40 17.2 C47 17.2 53.2 22 51.6 36.4 C50 30 46.6 25.4 40 23.6 C33.4 25.4 30 30 28.4 36.4 Z" fill={color} />;
  }
  if (style === 1) {
    // Side part
    return (
      <>
        <path d="M28.4 34 C25.8 20.6 33 16.2 41 16.2 C49 16.2 54.2 20.6 51.6 32.6 C49.2 26 44 23.4 37 25 C33 26 30 29 28.4 34 Z" fill={color} />
        <path d="M35 18.6 Q33.6 21.6 34.4 24.6" stroke="rgba(255,255,255,0.12)" strokeWidth="0.9" fill="none" />
      </>
    );
  }
  if (style === 2) {
    // Quiff
    return <path d="M28.4 33.4 C26.8 22 30.8 15.6 38 14 C44.6 12.6 52.6 15.6 52.2 24 C52 27.6 51.8 30.4 51.6 33.4 C50 27.2 45.2 24.6 40 24.6 C34 24.6 30 27.2 28.4 33.4 Z" fill={color} />;
  }
  if (style === 3) {
    // Curls
    return (
      <g fill={color}>
        <path d="M28.4 34 C27.4 24 33 19.4 40 19.4 C47 19.4 52.6 24 51.6 34 C50 28.4 46 25.6 40 25.6 C34 25.6 30 28.4 28.4 34 Z" />
        <circle cx="30.2" cy="27.6" r="4" />
        <circle cx="33.4" cy="22.6" r="4.4" />
        <circle cx="38.4" cy="19.8" r="4.8" />
        <circle cx="44" cy="20.2" r="4.6" />
        <circle cx="48.6" cy="23.4" r="4.3" />
        <circle cx="50.6" cy="28.4" r="3.8" />
      </g>
    );
  }
  if (style === 4) {
    // Close crop
    return <path d="M28.6 32.6 C27.6 21.6 33.6 18.2 40 18.2 C46.4 18.2 52.4 21.6 51.4 32.6 C50.2 27 46 24.4 40 24.4 C34 24.4 29.8 27 28.6 32.6 Z" fill={color} opacity="0.9" />;
  }
  // Short and neat
  return <path d="M28.4 33.2 C26.8 20.4 33.6 16.8 40 16.8 C47 16.8 53.2 20.4 51.6 33.2 C50.2 27 46 24 40 24 C34 24 29.8 27 28.4 33.2 Z" fill={color} />;
}
