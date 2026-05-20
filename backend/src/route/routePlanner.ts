export type RouteStopKind = "fuel" | "rest" | "repair" | "border";
export type RouteRiskLevel = "low" | "medium" | "high";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RouteWeather {
  condition: string;
  tempC: number;
  rainChance: number;
  windKph: number;
  riskLevel: RouteRiskLevel;
  advisory: string;
  source?: "starter" | "open-meteo" | "fallback";
  observedAt?: string;
  precipitationMm?: number;
}

export interface RouteStop {
  kind: RouteStopKind;
  label: string;
  priority: "optional" | "recommended" | "required";
}

export interface RouteWaypoint {
  id: string;
  name: string;
  province: string;
  distanceFromStartKm: number;
  eta: string;
  coordinate: GeoPoint;
  roadNote: string;
  weather: RouteWeather;
  stop: RouteStop | null;
  borderChecklist: string[];
}

export interface RoutePlan {
  tripId: string;
  provider: "starter" | "osm";
  title: string;
  origin: string;
  destination: string;
  totalDistanceKm: number;
  durationMinutes: number;
  generatedAt: string;
  geometry: GeoPoint[];
  offlinePack: {
    status: "ready";
    mapTilesMb: number;
    expiresInHours: number;
  };
  summary: {
    suggestedStops: number;
    weatherAlerts: number;
    borderAlerts: number;
    nextCriticalStop: string | null;
  };
  waypoints: RouteWaypoint[];
}

export interface RouteBuildInput {
  origin: string;
  destination: string;
  originCoordinate?: GeoPoint;
}

export class RoutePlannerError extends Error {
  constructor(
    readonly code: "INVALID_ROUTE_INPUT" | "GEOCODE_NOT_FOUND" | "ROUTE_NOT_FOUND" | "ROUTE_PROVIDER_ERROR",
    message: string,
  ) {
    super(message);
  }
}

export function buildStarterRoutePlan(tripId: string, now = new Date()): RoutePlan {
  return {
    tripId,
    provider: "starter",
    title: "Chưa có tuyến",
    origin: "",
    destination: "",
    totalDistanceKm: 0,
    durationMinutes: 0,
    generatedAt: now.toISOString(),
    geometry: [],
    offlinePack: {
      status: "ready",
      mapTilesMb: 0,
      expiresInHours: 24,
    },
    summary: summarizeRoute([]),
    waypoints: [],
  };
}

export async function buildOpenStreetRoutePlan(tripId: string, input: RouteBuildInput, now = new Date()): Promise<RoutePlan> {
  const originQuery = input.origin.trim();
  const destinationQuery = input.destination.trim();
  const originCoordinate = input.originCoordinate;
  const hasOriginCoordinate = isValidGeoPoint(originCoordinate);

  if ((!hasOriginCoordinate && originQuery.length < 2) || destinationQuery.length < 2 || originQuery.length > 160 || destinationQuery.length > 160) {
    throw new RoutePlannerError("INVALID_ROUTE_INPUT", "Điểm đi và điểm đến phải có từ 2 đến 160 ký tự");
  }

  const [origin, destination] = await Promise.all([
    hasOriginCoordinate ? Promise.resolve(createCoordinatePlace(originCoordinate, originQuery || "Vị trí của bạn")) : geocodePlace(originQuery),
    geocodePlace(destinationQuery),
  ]);
  const route = await fetchOsrmRoute(origin.coordinate, destination.coordinate);
  const waypoints = await enrichWaypointsWithWeather(
    createDynamicWaypoints(origin, destination, route.geometry, route.distanceKm, route.durationMinutes),
    now,
    route.distanceKm,
    route.durationMinutes,
  );

  return {
    tripId,
    provider: "osm",
    title: `${origin.name} - ${destination.name}`,
    origin: origin.name,
    destination: destination.name,
    totalDistanceKm: route.distanceKm,
    durationMinutes: route.durationMinutes,
    generatedAt: now.toISOString(),
    geometry: route.geometry,
    offlinePack: {
      status: "ready",
      mapTilesMb: estimateOfflinePackSize(route.distanceKm),
      expiresInHours: 24,
    },
    summary: summarizeRoute(waypoints),
    waypoints,
  };
}

function isValidGeoPoint(point: GeoPoint | undefined): point is GeoPoint {
  return (
    !!point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

export function summarizeRoute(waypoints: RouteWaypoint[]): RoutePlan["summary"] {
  const suggestedStops = waypoints.filter((waypoint) => waypoint.stop && waypoint.stop.priority !== "optional").length;
  const weatherAlerts = waypoints.filter((waypoint) => waypoint.weather.riskLevel !== "low").length;
  const borderAlerts = waypoints.filter((waypoint) => waypoint.borderChecklist.length > 0).length;
  const nextCriticalStop = waypoints.find(
    (waypoint) => waypoint.stop?.priority === "required" || waypoint.weather.riskLevel === "high" || waypoint.borderChecklist.length > 0,
  );

  return {
    suggestedStops,
    weatherAlerts,
    borderAlerts,
    nextCriticalStop: nextCriticalStop?.name ?? null,
  };
}

export function createDynamicWaypoints(
  origin: GeocodedPlace,
  destination: GeocodedPlace,
  geometry: GeoPoint[],
  distanceKm: number,
  durationMinutes: number,
): RouteWaypoint[] {
  const midpoint = geometry[Math.floor(geometry.length / 2)] ?? origin.coordinate;
  const needsRestStop = distanceKm >= 120;
  const destinationBorderChecklist = createBorderChecklist(destination.name);

  return [
    createRouteWaypoint({
      id: "origin",
      name: origin.name,
      province: origin.region,
      distanceFromStartKm: 0,
      eta: "Bắt đầu",
      coordinate: origin.coordinate,
      roadNote: "Kiểm tra xăng, lốp, giấy tờ và pin điện thoại trước khi xuất phát.",
      weather: createWeatherStub(0),
      stop: null,
      borderChecklist: [],
    }),
    ...(needsRestStop
      ? [
          createRouteWaypoint({
            id: "midpoint-rest",
            name: "Điểm nghỉ giữa chặng",
            province: "Theo tuyến",
            distanceFromStartKm: Math.round(distanceKm / 2),
            eta: formatDuration(Math.round(durationMinutes / 2)),
            coordinate: midpoint,
            roadNote: "Nên nghỉ 15-20 phút, bổ sung nước và kiểm tra xe.",
            weather: createWeatherStub(1),
            stop: {
              kind: "rest",
              label: "Nghỉ + kiểm tra xe",
              priority: "recommended",
            },
            borderChecklist: [],
          }),
        ]
      : []),
    createRouteWaypoint({
      id: "destination",
      name: destination.name,
      province: destination.region,
      distanceFromStartKm: distanceKm,
      eta: formatDuration(durationMinutes),
      coordinate: destination.coordinate,
      roadNote: destinationBorderChecklist.length
        ? "Điểm đến có dấu hiệu liên quan cửa khẩu, hãy kiểm tra giấy tờ trước khi tới."
        : "Gần tới điểm đến, kiểm tra lại lịch nghỉ và điểm đỗ xe.",
      weather: createWeatherStub(destinationBorderChecklist.length ? 2 : 1),
      stop: destinationBorderChecklist.length
        ? {
            kind: "border",
            label: "Kiểm tra cửa khẩu",
            priority: "required",
          }
        : null,
      borderChecklist: destinationBorderChecklist,
    }),
  ];
}

interface GeocodedPlace {
  name: string;
  region: string;
  coordinate: GeoPoint;
}

interface OsrmRoute {
  distanceKm: number;
  durationMinutes: number;
  geometry: GeoPoint[];
}

interface NominatimSearchResult {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

interface OsrmRouteResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      coordinates?: Array<[number, number]>;
      type?: string;
    };
  }>;
}

interface OpenMeteoForecastResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    precipitation?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation?: number[];
    precipitation_probability?: number[];
    wind_speed_10m?: number[];
    weather_code?: number[];
  };
}

async function geocodePlace(query: string): Promise<GeocodedPlace> {
  const baseUrl = process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "vi,en");

  const data = await fetchJson<NominatimSearchResult[]>(url, "GEOCODE_NOT_FOUND");
  const first = data[0];
  const lat = Number(first?.lat);
  const lng = Number(first?.lon);

  if (!first || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new RoutePlannerError("GEOCODE_NOT_FOUND", `Không tìm thấy địa điểm: ${query}`);
  }

  return {
    name: simplifyPlaceName(first.display_name ?? query),
    region: first.address?.city ?? first.address?.town ?? first.address?.village ?? first.address?.county ?? first.address?.state ?? first.address?.country ?? "OSM",
    coordinate: { lat, lng },
  };
}

function createCoordinatePlace(coordinate: GeoPoint, label: string): GeocodedPlace {
  return {
    name: label,
    region: "GPS",
    coordinate,
  };
}

async function fetchOsrmRoute(origin: GeoPoint, destination: GeoPoint): Promise<OsrmRoute> {
  const baseUrl = process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(`/route/v1/driving/${coordinates}`, baseUrl);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  url.searchParams.set("alternatives", "false");

  const data = await fetchJson<OsrmRouteResponse>(url, "ROUTE_PROVIDER_ERROR");
  const route = data.routes?.[0];
  const coordinatesList = route?.geometry?.coordinates;

  if (data.code !== "Ok" || !route || !Array.isArray(coordinatesList) || coordinatesList.length < 2) {
    throw new RoutePlannerError("ROUTE_NOT_FOUND", "Không tìm thấy đường phù hợp giữa hai điểm");
  }

  return {
    distanceKm: Math.max(1, Math.round((route.distance ?? 0) / 1000)),
    durationMinutes: Math.max(1, Math.round((route.duration ?? 0) / 60)),
    geometry: coordinatesList
      .map(([lng, lat]) => ({ lat, lng }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)),
  };
}

async function enrichWaypointsWithWeather(waypoints: RouteWaypoint[], now: Date, totalDistanceKm: number, totalDurationMinutes: number): Promise<RouteWaypoint[]> {
  const weatherByWaypoint = await Promise.all(
    waypoints.map(async (waypoint, index) => {
      try {
        const etaOffsetMinutes = totalDistanceKm > 0 ? Math.round((waypoint.distanceFromStartKm / totalDistanceKm) * totalDurationMinutes) : 0;
        const targetTime = new Date(now.getTime() + etaOffsetMinutes * 60_000);
        return await fetchOpenMeteoWeather(waypoint.coordinate, targetTime);
      } catch {
        return createWeatherStub(index);
      }
    }),
  );

  return waypoints.map((waypoint, index) => ({
    ...waypoint,
    weather: weatherByWaypoint[index] ?? waypoint.weather,
  }));
}

async function fetchOpenMeteoWeather(coordinate: GeoPoint, targetTime: Date): Promise<RouteWeather> {
  const baseUrl = process.env.OPEN_METEO_BASE_URL ?? "https://api.open-meteo.com";
  const url = new URL("/v1/forecast", baseUrl);
  url.searchParams.set("latitude", String(coordinate.lat));
  url.searchParams.set("longitude", String(coordinate.lng));
  url.searchParams.set("current", "temperature_2m,precipitation,wind_speed_10m,weather_code");
  url.searchParams.set("hourly", "temperature_2m,precipitation,precipitation_probability,wind_speed_10m,weather_code");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const data = await fetchJson<OpenMeteoForecastResponse>(url, "ROUTE_PROVIDER_ERROR");
  const forecast = pickNearestHourlyWeather(data.hourly, targetTime);
  const current = data.current;
  const tempC = Math.round(Number(forecast.temperature_2m ?? current?.temperature_2m));
  const precipitationMm = roundToOneDecimal(Number(forecast.precipitation ?? current?.precipitation ?? 0));
  const windKph = Math.round(Number(forecast.wind_speed_10m ?? current?.wind_speed_10m));
  const weatherCode = Math.round(Number(forecast.weather_code ?? current?.weather_code ?? 0));
  const rainChance = Math.max(0, Math.min(100, Math.round(Number(forecast.precipitation_probability ?? 0))));

  if (!Number.isFinite(tempC) || !Number.isFinite(windKph) || !Number.isFinite(rainChance)) {
    throw new RoutePlannerError("ROUTE_PROVIDER_ERROR", "Dữ liệu thời tiết không hợp lệ");
  }

  const condition = weatherCodeToCondition(weatherCode);
  const riskLevel = calculateWeatherRisk(weatherCode, rainChance, windKph, precipitationMm);
  const observedAt = forecast.time ?? current?.time;

  return {
    condition,
    tempC,
    rainChance,
    windKph,
    riskLevel,
    advisory: createWeatherAdvisory(riskLevel, condition, rainChance, windKph, precipitationMm),
    source: "open-meteo",
    ...(observedAt ? { observedAt } : {}),
    precipitationMm,
  };
}

async function fetchJson<T>(url: URL, fallbackCode: RoutePlannerError["code"]): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TrailLedger/0.1 route-builder",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RoutePlannerError(fallbackCode, "Dịch vụ bản đồ tạm thời không phản hồi");
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof RoutePlannerError) {
      throw error;
    }

    throw new RoutePlannerError("ROUTE_PROVIDER_ERROR", "Không kết nối được dịch vụ bản đồ");
  } finally {
    clearTimeout(timeout);
  }
}

function createRouteWaypoint(input: RouteWaypoint): RouteWaypoint {
  return input;
}

function pickNearestHourlyWeather(hourly: OpenMeteoForecastResponse["hourly"], targetTime: Date): {
  time?: string;
  temperature_2m?: number;
  precipitation?: number;
  precipitation_probability?: number;
  wind_speed_10m?: number;
  weather_code?: number;
} {
  const times = hourly?.time ?? [];

  if (!times.length) {
    return {};
  }

  const target = targetTime.getTime();

  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;

  times.forEach((time, index) => {
    const parsed = Date.parse(time);

    if (!Number.isFinite(parsed)) {
      return;
    }

    const delta = Math.abs(parsed - target);

    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });

  const forecast: {
    time?: string;
    temperature_2m?: number;
    precipitation?: number;
    precipitation_probability?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  } = {};
  const time = times[bestIndex];
  const temperature = hourly?.temperature_2m?.[bestIndex];
  const precipitation = hourly?.precipitation?.[bestIndex];
  const precipitationProbability = hourly?.precipitation_probability?.[bestIndex];
  const windSpeed = hourly?.wind_speed_10m?.[bestIndex];
  const weatherCode = hourly?.weather_code?.[bestIndex];

  if (time) {
    forecast.time = time;
  }

  if (typeof temperature === "number") {
    forecast.temperature_2m = temperature;
  }

  if (typeof precipitation === "number") {
    forecast.precipitation = precipitation;
  }

  if (typeof precipitationProbability === "number") {
    forecast.precipitation_probability = precipitationProbability;
  }

  if (typeof windSpeed === "number") {
    forecast.wind_speed_10m = windSpeed;
  }

  if (typeof weatherCode === "number") {
    forecast.weather_code = weatherCode;
  }

  return forecast;
}

function weatherCodeToCondition(code: number): string {
  if (code === 0) {
    return "Trời quang";
  }

  if (code >= 1 && code <= 3) {
    return "Nhiều mây";
  }

  if (code === 45 || code === 48) {
    return "Sương mù";
  }

  if (code >= 51 && code <= 57) {
    return "Mưa phùn";
  }

  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return "Mưa";
  }

  if (code >= 71 && code <= 77) {
    return "Mưa lạnh";
  }

  if (code >= 95) {
    return "Dông sét";
  }

  return "Thời tiết ổn định";
}

function calculateWeatherRisk(code: number, rainChance: number, windKph: number, precipitationMm: number): RouteRiskLevel {
  if (code >= 95 || rainChance >= 75 || windKph >= 40 || precipitationMm >= 8) {
    return "high";
  }

  if (rainChance >= 45 || windKph >= 25 || precipitationMm >= 2 || (code >= 51 && code <= 82)) {
    return "medium";
  }

  return "low";
}

function createWeatherAdvisory(riskLevel: RouteRiskLevel, condition: string, rainChance: number, windKph: number, precipitationMm: number): string {
  if (riskLevel === "high") {
    return `Cân nhắc dừng nghỉ: ${condition.toLowerCase()}, mưa ${rainChance}%, gió ${windKph} km/h. Bọc đồ và giảm tốc độ.`;
  }

  if (riskLevel === "medium") {
    return `Nên chuẩn bị áo mưa: ${condition.toLowerCase()}, mưa ${rainChance}%, gió ${windKph} km/h.`;
  }

  if (precipitationMm > 0) {
    return `Có mưa nhẹ ${precipitationMm} mm, vẫn có thể đi nhưng nên bọc giấy tờ.`;
  }

  return "Điều kiện ổn, có thể tiếp tục chặng này.";
}

function roundToOneDecimal(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 10) / 10;
}

function createWeatherStub(index: number): RouteWeather {
  const presets: RouteWeather[] = [
    {
      condition: "Chưa đồng bộ",
      tempC: 27,
      rainChance: 20,
      windKph: 10,
      riskLevel: "low",
      advisory: "Chưa lấy được thời tiết thật, dùng dữ liệu dự phòng.",
      source: "fallback",
    },
    {
      condition: "Chưa đồng bộ",
      tempC: 26,
      rainChance: 42,
      windKph: 15,
      riskLevel: "medium",
      advisory: "Nên kiểm tra lại thời tiết trước khi chạy chặng dài.",
      source: "fallback",
    },
    {
      condition: "Chưa đồng bộ",
      tempC: 24,
      rainChance: 55,
      windKph: 18,
      riskLevel: "medium",
      advisory: "Gần cửa khẩu, hãy chống nước giấy tờ và dự phòng thời gian.",
      source: "fallback",
    },
  ];

  return presets[index] ?? presets[0]!;
}

function createBorderChecklist(placeName: string): string[] {
  const normalized = placeName.toLowerCase();
  const borderKeywords = ["cua khau", "cửa khẩu", "border", "huu nghi", "hữu nghị", "mong cai", "móng cái", "lao bao", "lao bảo"];

  if (!borderKeywords.some((keyword) => normalized.includes(keyword))) {
    return [];
  }

  return ["Passport", "Visa/permit nếu cần", "Đăng ký xe", "Bảo hiểm xe", "Tiền mặt địa phương dự phòng"];
}

function simplifyPlaceName(displayName: string): string {
  return displayName
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
}

function estimateOfflinePackSize(distanceKm: number): number {
  return Math.max(48, Math.min(520, Math.round(distanceKm * 0.65)));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} phút`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}
