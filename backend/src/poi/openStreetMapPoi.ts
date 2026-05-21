import type { GeoPoint, RoutePlan } from "../route/routePlanner.js";

export type TripPoiKind = "food" | "lodging" | "fuel";

export interface TripPoi {
  id: string;
  name: string;
  kind: TripPoiKind;
  latitude: number;
  longitude: number;
  distanceFromRouteKm: number;
  source: "openstreetmap";
  osmType: "node" | "way" | "relation";
  osmId: number;
  detail: string | null;
}

interface FindRoutePoisOptions {
  kinds: TripPoiKind[];
  limit?: number;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat?: number;
    lon?: number;
  };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

const overpassEndpoint = "https://overpass-api.de/api/interpreter";
const searchRadiusMeters = 3000;

export async function findOpenStreetMapPoisForRoute(routePlan: RoutePlan, options: FindRoutePoisOptions): Promise<TripPoi[]> {
  const routePoints = routePlan.geometry.length ? routePlan.geometry : routePlan.waypoints.map((waypoint) => waypoint.coordinate);
  const samplePoints = sampleRoutePoints(routePoints, 7);
  const kinds = options.kinds.length ? options.kinds : (["food", "lodging", "fuel"] satisfies TripPoiKind[]);

  if (!samplePoints.length || routePlan.totalDistanceKm <= 0) {
    return [];
  }

  const response = await fetch(overpassEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "User-Agent": "TrailLedger/0.1 POI lookup",
    },
    body: buildOverpassQuery(samplePoints, kinds),
  });

  if (!response.ok) {
    throw new Error("OPENSTREETMAP_POI_UNAVAILABLE");
  }

  const data = (await response.json()) as OverpassResponse;
  const pois = new Map<string, TripPoi>();

  for (const element of data.elements ?? []) {
    const poi = toTripPoi(element, routePoints, kinds);

    if (poi && poi.distanceFromRouteKm <= 5) {
      pois.set(poi.id, poi);
    }
  }

  return [...pois.values()]
    .sort((left, right) => left.distanceFromRouteKm - right.distanceFromRouteKm || left.name.localeCompare(right.name))
    .slice(0, Math.max(1, Math.min(options.limit ?? 80, 120)));
}

function buildOverpassQuery(points: GeoPoint[], kinds: TripPoiKind[]): string {
  const blocks: string[] = [];
  const wantsFood = kinds.includes("food");
  const wantsLodging = kinds.includes("lodging");
  const wantsFuel = kinds.includes("fuel");

  for (const point of points) {
    const around = `(around:${searchRadiusMeters},${point.lat},${point.lng})`;

    if (wantsFood) {
      blocks.push(`node["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub)$"]${around};`);
      blocks.push(`way["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub)$"]${around};`);
    }

    if (wantsFuel) {
      blocks.push(`node["amenity"="fuel"]${around};`);
      blocks.push(`way["amenity"="fuel"]${around};`);
    }

    if (wantsLodging) {
      blocks.push(`node["tourism"~"^(hotel|guest_house|hostel|motel|apartment)$"]${around};`);
      blocks.push(`way["tourism"~"^(hotel|guest_house|hostel|motel|apartment)$"]${around};`);
    }
  }

  return `[out:json][timeout:14];(${blocks.join("\n")});out center 180;`;
}

function toTripPoi(element: OverpassElement, routePoints: GeoPoint[], allowedKinds: TripPoiKind[]): TripPoi | null {
  const coordinate = readElementCoordinate(element);
  const kind = readPoiKind(element.tags ?? {});

  if (!coordinate || !kind || !allowedKinds.includes(kind)) {
    return null;
  }

  const name = readPoiName(element.tags ?? {}, kind);

  return {
    id: `${element.type}-${element.id}`,
    name,
    kind,
    latitude: coordinate.lat,
    longitude: coordinate.lng,
    distanceFromRouteKm: roundToOneDecimal(distanceToRouteKm(coordinate, routePoints)),
    source: "openstreetmap",
    osmType: element.type,
    osmId: element.id,
    detail: readPoiDetail(element.tags ?? {}),
  };
}

function readElementCoordinate(element: OverpassElement): GeoPoint | null {
  const lat = typeof element.lat === "number" ? element.lat : element.center?.lat;
  const lng = typeof element.lon === "number" ? element.lon : element.center?.lon;

  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function readPoiKind(tags: Record<string, string>): TripPoiKind | null {
  if (tags.amenity === "fuel") {
    return "fuel";
  }

  if (tags.tourism && ["hotel", "guest_house", "hostel", "motel", "apartment"].includes(tags.tourism)) {
    return "lodging";
  }

  if (tags.amenity && ["restaurant", "cafe", "fast_food", "food_court", "bar", "pub"].includes(tags.amenity)) {
    return "food";
  }

  return null;
}

function readPoiName(tags: Record<string, string>, kind: TripPoiKind): string {
  const name = tags.name || tags["name:vi"] || tags.brand;

  if (name?.trim()) {
    return name.trim().slice(0, 90);
  }

  if (kind === "fuel") {
    return "Cây xăng";
  }

  if (kind === "lodging") {
    return "Nơi nghỉ";
  }

  return "Quán ăn";
}

function readPoiDetail(tags: Record<string, string>): string | null {
  const parts = [tags.cuisine, tags.tourism, tags.amenity, tags.operator].filter(Boolean).slice(0, 2);
  return parts.length ? parts.join(" · ") : null;
}

function sampleRoutePoints(points: GeoPoint[], maxPoints: number): GeoPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const sampled: GeoPoint[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(points[Math.round((index * (points.length - 1)) / (maxPoints - 1))]!);
  }

  return sampled;
}

function distanceToRouteKm(point: GeoPoint, routePoints: GeoPoint[]): number {
  if (!routePoints.length) {
    return 0;
  }

  return Math.min(...routePoints.map((routePoint) => haversineKm(point, routePoint)));
}

function haversineKm(left: GeoPoint, right: GeoPoint): number {
  const earthRadiusKm = 6371;
  const dLat = degreesToRadians(right.lat - left.lat);
  const dLng = degreesToRadians(right.lng - left.lng);
  const lat1 = degreesToRadians(left.lat);
  const lat2 = degreesToRadians(right.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
