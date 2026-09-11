"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { feature } from "topojson-client";
import {
  geoEqualEarth,
  geoPath,
  geoGraticule10,
  geoInterpolate,
  type GeoPermissibleObjects,
} from "d3-geo";
import { zoom as d3Zoom, zoomIdentity } from "d3-zoom";
import { select } from "d3-selection";
import type { Topology, GeometryCollection } from "topojson-specification";
import { Filter, Maximize2, Minimize2, RotateCcw, Ship } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button } from "@/components/ui/primitives";
import { usd } from "@/lib/trade/commandCenterMetrics";
import {
  congestionColor,
  filterMapShipments,
  listMapPorts,
  progressForMapStatus,
  shipmentStrokeColor,
  type MapFilterMode,
  type MapShipment,
} from "@/lib/trade/shipmentMap";

type WorldTopo = Topology<{ countries: GeometryCollection }>;

const W = 1200;
const H = 620;

function greatCircleCoords(
  from: [number, number],
  to: [number, number],
  n = 64,
): [number, number][] {
  const interpolate = geoInterpolate(from, to);
  const coords: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const p = interpolate(i / n);
    coords.push([p[0], p[1]]);
  }
  return coords;
}

function useWorldTopo() {
  const [topo, setTopo] = useState<WorldTopo | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch("/geo/countries-110m.json")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load world map");
        return r.json();
      })
      .then((json: WorldTopo) => {
        if (!cancelled) setTopo(json);
      })
      .catch(() => {
        if (!cancelled) setTopo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { topo, loading };
}

export function TradeMapCanvas({
  shipments,
  compact = false,
  className,
}: {
  shipments: MapShipment[];
  compact?: boolean;
  className?: string;
}) {
  const { topo, loading } = useWorldTopo();
  const ports = useMemo(() => listMapPorts(), []);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [filter, setFilter] = useState<MapFilterMode>("all");
  const [showPorts, setShowPorts] = useState(true);
  const [showLabels, setShowLabels] = useState(!compact);
  const [fullscreen, setFullscreen] = useState(false);
  const [hovered, setHovered] = useState<{
    type: "port" | "ship";
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [selected, setSelected] = useState<MapShipment | null>(null);

  const width = compact ? 560 : W;
  const height = compact ? 280 : H;

  const projection = useMemo(
    () =>
      geoEqualEarth().fitExtent(
        [
          [12, 12],
          [width - 12, height - 12],
        ],
        { type: "Sphere" },
      ),
    [width, height],
  );
  const pathGen = useMemo(() => geoPath(projection), [projection]);

  const countries = useMemo(() => {
    if (!topo) return null;
    return feature(topo, topo.objects.countries);
  }, [topo]);

  const graticulePath = useMemo(
    () => pathGen(geoGraticule10() as GeoPermissibleObjects) ?? "",
    [pathGen],
  );
  const spherePath = useMemo(
    () => pathGen({ type: "Sphere" }) ?? "",
    [pathGen],
  );

  const visible = useMemo(
    () => filterMapShipments(shipments, filter).slice(0, compact ? 22 : 80),
    [shipments, filter, compact],
  );

  const arcs = useMemo(() => {
    return visible.map((s) => {
      const coords = greatCircleCoords(
        s.coords.origin,
        s.coords.dest,
        compact ? 40 : 72,
      );
      const d =
        pathGen({ type: "LineString", coordinates: coords } as GeoPermissibleObjects) ??
        "";
      const progress = progressForMapStatus(s.status);
      const vesselLonLat = geoInterpolate(s.coords.origin, s.coords.dest)(
        progress,
      );
      const vesselPx = projection(vesselLonLat as [number, number]);
      return { shipment: s, d, vesselPx, stroke: shipmentStrokeColor(s) };
    });
  }, [visible, pathGen, projection, compact]);

  const portPoints = useMemo(() => {
    return ports
      .map((p) => {
        const xy = projection(p.coords);
        return { port: p, xy };
      })
      .filter(
        (p): p is { port: (typeof ports)[number]; xy: [number, number] } =>
          !!p.xy,
      );
  }, [ports, projection]);

  useEffect(() => {
    if (compact || !svgRef.current || !gRef.current) return;
    const svg = select(svgRef.current);
    const g = select(gRef.current);
    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.85, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoomBehavior);
    return () => {
      svg.on(".zoom", null);
    };
  }, [compact, topo]);

  const resetView = useCallback(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = select(svgRef.current);
    const g = select(gRef.current);
    svg.call(
      d3Zoom<SVGSVGElement, unknown>().transform as never,
      zoomIdentity,
    );
    g.attr("transform", "");
  }, []);

  const hoveredPort =
    hovered?.type === "port"
      ? ports.find((p) => p.code === hovered.id)
      : null;
  const hoveredShip =
    hovered?.type === "ship"
      ? visible.find((s) => s.id === hovered.id)
      : null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-zinc-200",
        fullscreen ? "fixed inset-3 z-50 rounded-2xl" : "",
        className,
      )}
      style={{
        background:
          "radial-gradient(ellipse at 50% 42%, #e8f1fa 0%, #f1f5f9 45%, #ffffff 100%)",
      }}
    >
      {!compact ? (
        <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200/80 bg-white/95 p-1 shadow-lg backdrop-blur">
            <Filter className="ml-1.5 h-3.5 w-3.5 text-zinc-500" />
            {(
              [
                ["all", "All"],
                ["on_water", "On water"],
                ["delayed", "Delayed"],
                ["arrived", "Arrived"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === k
                    ? "bg-teal-700 text-white"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200/80 bg-white/95 p-1 shadow-lg backdrop-blur">
            <button
              type="button"
              onClick={() => setShowPorts(!showPorts)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                showPorts ? "bg-zinc-100 text-zinc-900" : "text-zinc-500",
              )}
            >
              Ports
            </button>
            <button
              type="button"
              onClick={() => setShowLabels(!showLabels)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                showLabels ? "bg-zinc-100 text-zinc-900" : "text-zinc-500",
              )}
            >
              Labels
            </button>
            <Button variant="ghost" className="h-7 w-7 px-0" onClick={resetView}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              className="h-7 w-7 px-0"
              onClick={() => setFullscreen((f) => !f)}
            >
              {fullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      ) : null}

      {(loading || !countries) && (
        <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-zinc-500">
          Loading world chart…
        </div>
      )}

      {countries ? (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className={cn(
            "h-auto w-full touch-none",
            compact ? "min-h-[180px]" : "min-h-[420px]",
          )}
          role="img"
          aria-label="Shipment trade map"
        >
          <defs>
            <radialGradient id="oceanGlow" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#dbeafe" stopOpacity="1" />
              <stop offset="100%" stopColor="#eff6ff" stopOpacity="1" />
            </radialGradient>
            <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g ref={gRef}>
            <path
              d={spherePath}
              fill="url(#oceanGlow)"
              stroke="#94a3b8"
              strokeWidth={1}
            />
            <path
              d={graticulePath}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth={0.45}
              opacity={0.9}
            />
            <g>
              {(countries as GeoJSON.FeatureCollection).features.map((f, i) => {
                const d = pathGen(f as GeoPermissibleObjects);
                if (!d) return null;
                return (
                  <path
                    key={i}
                    d={d}
                    fill="#e2e8f0"
                    stroke="#94a3b8"
                    strokeWidth={0.45}
                  />
                );
              })}
            </g>
            <path
              d={pathGen(countries as GeoPermissibleObjects) ?? ""}
              fill="none"
              stroke="#64748b"
              strokeWidth={0.35}
              opacity={0.45}
            />

            <g>
              {arcs.map(({ shipment, d, vesselPx, stroke }) => (
                <g key={shipment.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={compact ? 1.1 : 1.6}
                    strokeOpacity={0.25}
                    strokeLinecap="round"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={compact ? 1 : 1.35}
                    strokeOpacity={0.9}
                    strokeLinecap="round"
                    strokeDasharray="6 8"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => {
                      const rect = (
                        e.target as SVGPathElement
                      ).ownerSVGElement?.getBoundingClientRect();
                      setHovered({
                        type: "ship",
                        id: shipment.id,
                        x: e.clientX - (rect?.left ?? 0),
                        y: e.clientY - (rect?.top ?? 0),
                      });
                    }}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => !compact && setSelected(shipment)}
                  />
                  {vesselPx ? (
                    <g
                      transform={`translate(${vesselPx[0]}, ${vesselPx[1]})`}
                      filter={compact ? undefined : "url(#softGlow)"}
                    >
                      <circle r={compact ? 2.2 : 3.4} fill={stroke} opacity={0.35} />
                      <circle
                        r={compact ? 1.4 : 2.1}
                        fill="#ffffff"
                        stroke={stroke}
                        strokeWidth={1.4}
                      />
                    </g>
                  ) : null}
                </g>
              ))}
            </g>

            {showPorts ? (
              <g>
                {portPoints.map(({ port, xy }) => {
                  const color = congestionColor(port.congestionLevel);
                  const r = compact ? 2.2 : 2.8 + port.congestionLevel * 0.35;
                  return (
                    <g
                      key={port.code}
                      transform={`translate(${xy[0]}, ${xy[1]})`}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={(e) => {
                        const rect = (
                          e.target as SVGElement
                        ).ownerSVGElement?.getBoundingClientRect();
                        setHovered({
                          type: "port",
                          id: port.code,
                          x: e.clientX - (rect?.left ?? 0),
                          y: e.clientY - (rect?.top ?? 0),
                        });
                      }}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {port.congestionLevel >= 3 ? (
                        <circle r={r + 4} fill={color} opacity={0.15}>
                          <animate
                            attributeName="r"
                            values={`${r + 3};${r + 7};${r + 3}`}
                            dur="2.4s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            values="0.25;0.05;0.25"
                            dur="2.4s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      ) : null}
                      <circle r={r + 1.5} fill={color} opacity={0.25} />
                      <circle r={r} fill={color} stroke="#ffffff" strokeWidth={1} />
                      {showLabels && !compact && port.congestionLevel >= 2 ? (
                        <text
                          x={r + 4}
                          y={3}
                          fill="#334155"
                          fontSize={8.5}
                          style={{ pointerEvents: "none" }}
                        >
                          {port.name}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            ) : null}
          </g>
        </svg>
      ) : null}

      {hovered && (hoveredPort || hoveredShip) ? (
        <div
          className="pointer-events-none absolute z-30 max-w-xs rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={{
            left: Math.min(hovered.x + 12, compact ? 400 : 900),
            top: Math.max(8, hovered.y - 10),
          }}
        >
          {hoveredPort ? (
            <>
              <p className="font-semibold text-zinc-900">
                {hoveredPort.name}{" "}
                <span className="font-mono text-zinc-500">
                  ({hoveredPort.code})
                </span>
              </p>
              <p className="text-zinc-500">{hoveredPort.country}</p>
              <p className="mt-1">
                Congestion{" "}
                <Badge
                  tone={
                    hoveredPort.congestionLevel >= 4
                      ? "danger"
                      : hoveredPort.congestionLevel >= 3
                        ? "warning"
                        : "info"
                  }
                >
                  L{hoveredPort.congestionLevel}
                </Badge>
                <span className="ml-2 text-zinc-500">
                  avg wait {hoveredPort.avgWaitDays.toFixed(1)}d
                </span>
              </p>
            </>
          ) : null}
          {hoveredShip ? (
            <>
              <p className="flex items-center gap-1.5 font-semibold">
                <Ship className="h-3.5 w-3.5 text-teal-700" />
                {hoveredShip.vessel}
                {hoveredShip.voyage ? ` · ${hoveredShip.voyage}` : ""}
              </p>
              <p className="text-zinc-500">
                {hoveredShip.originPort} → {hoveredShip.destinationPort}
              </p>
              <p className="mt-1 font-mono text-[11px] text-teal-800">
                {hoveredShip.dealCode}
              </p>
              {hoveredShip.delayDays > 0 ? (
                <p className="mt-0.5 text-amber-700">
                  +{hoveredShip.delayDays}d delay
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {!compact && selected ? (
        <div className="absolute bottom-3 right-3 z-20 w-80 rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{selected.vessel}</p>
              <p className="text-xs text-zinc-500">
                {[selected.carrier, selected.voyage].filter(Boolean).join(" · ") ||
                  selected.status}
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-900"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
          </div>
          <div className="space-y-1.5 text-xs">
            <p>
              <span className="text-zinc-500">Lane</span> · {selected.originPort}{" "}
              → {selected.destinationPort}
            </p>
            <p>
              <span className="text-zinc-500">Deal</span> ·{" "}
              <span className="font-mono">{selected.dealCode}</span>
            </p>
            {selected.blNumber ? (
              <p>
                <span className="text-zinc-500">BL / booking</span> ·{" "}
                {selected.blNumber}
              </p>
            ) : null}
            {selected.eta ? (
              <p>
                <span className="text-zinc-500">ETA</span> · {selected.eta}
                {selected.delayDays > 0 ? ` (+${selected.delayDays}d)` : ""}
              </p>
            ) : null}
            <p>
              <span className="text-zinc-500">Cargo</span> ·{" "}
              {usd(selected.cargoValueUsd)}
            </p>
          </div>
          <Link
            href={selected.href}
            className="mt-3 inline-flex text-xs font-medium text-teal-700 hover:underline"
          >
            Open deal →
          </Link>
        </div>
      ) : null}

      <div
        className={cn(
          "absolute z-10 flex flex-wrap gap-3 rounded-lg border border-zinc-200/80 bg-white/90 px-3 py-2 text-[10px] text-zinc-500 backdrop-blur",
          compact ? "bottom-2 left-2" : "bottom-3 left-3",
        )}
      >
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-sky-500" /> On schedule
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-500" /> Delayed
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500" /> Severe
        </span>
      </div>

      {!compact ? (
        <div className="absolute right-3 top-3 z-10 rounded-lg border border-zinc-200/80 bg-white/90 px-2.5 py-1.5 text-[10px] text-zinc-500 backdrop-blur">
          Equal Earth · {arcs.length} lanes · {portPoints.length} ports
        </div>
      ) : null}
    </div>
  );
}
