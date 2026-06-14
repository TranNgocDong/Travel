"use client";

import {
  ArrowRightLeft,
  Archive,
  Bike,
  Calculator,
  Check,
  CloudRain,
  CloudOff,
  Download,
  Trash2,
  Fuel,
  Map,
  MapPin,
  Maximize2,
  MessageCircle,
  Minimize2,
  Moon,
  Navigation,
  Phone,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Smile,
  Sun,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AuthScreen } from "@/components/AuthScreen";
import {
  addTripMember,
  createExpense,
  createTripMapMarker,
  createMemberRoute,
  createTrip,
  defaultTripId,
  deleteMemberRoute,
  deleteTrip,
  deleteTripMapMarker,
  fetchExpenses,
  fetchMemberLocationAddress,
  fetchMe,
  fetchMemberRoutes,
  fetchRoutePlan,
  fetchTripMessages,
  fetchTripLocations,
  fetchTripMapMarkers,
  fetchTripPois,
  fetchTripPresence,
  fetchSettlementResult,
  fetchTripMembers,
  fetchTrips,
  getCurrentFirebaseUser,
  logout,
  planRoute,
  removeTripMember,
  shareMyLocation,
  sendTripMessage,
  subscribeToTripEvents,
  stopSharingMyLocation,
  updateTripMember,
  updateTripStatus,
  type ApiBalance,
  type ApiCreateExpensePayload,
  type ApiExpense,
  type ApiExpenseSplit,
  type ApiGeoPoint,
  type ApiMapMarker,
  type ApiMapMarkerKind,
  type ApiMemberRoute,
  type ApiMemberLocation,
  type ApiMemberLocationAddress,
  type ApiPresenceUser,
  type ApiRoutePlan,
  type ApiRouteStopKind,
  type ApiRouteWaypoint,
  type ApiSettlement,
  type ApiTrip,
  type ApiTripPoi,
  type ApiTripPoiKind,
  type ApiTripLiveEvent,
  type ApiTripMember,
  type ApiTripMemberAvatarColor,
  type ApiTripMemberBackgroundKey,
  type ApiTripMemberTravelStatus,
  type ApiTripMessage,
  type ApiTripRole,
  type ApiTripStatus,
  type ApiUser,
} from "@/lib/api";
import { clearAutoEnterApp, shouldAutoEnterApp } from "@/lib/authPreferences";
import { currencyRatesToVnd, formatMoney, type CurrencyCode, type Member, type SplitMode, toVnd } from "@/lib/settlements";

type TripMemberView = Member & {
  role: ApiTripRole;
  active: boolean;
  removedAt: string | null;
  phoneNumber: string | null;
  homeBase: string | null;
  travelStatus: ApiTripMemberTravelStatus;
  statusEmoji: string;
  avatarColor: ApiTripMemberAvatarColor;
  backgroundKey: ApiTripMemberBackgroundKey;
};

type MemberProfileDraft = {
  displayName: string;
  phoneNumber: string;
  homeBase: string;
  travelStatus: ApiTripMemberTravelStatus;
  statusEmoji: string;
  avatarColor: ApiTripMemberAvatarColor;
  backgroundKey: ApiTripMemberBackgroundKey;
};

type MobileTab = "route" | "expenses" | "group" | "recap";

type OfflineExpenseQueueItem = {
  id: string;
  tripId: string;
  payload: ApiCreateExpensePayload;
  createdAt: string;
};

type PresenceNotice = {
  id: string;
  message: string;
  tone: "join" | "leave" | "message";
};

type FocusedLocationRequest = {
  userId: string;
  requestedAt: number;
};

const defaultProfileDraft: MemberProfileDraft = {
  displayName: "",
  phoneNumber: "",
  homeBase: "",
  travelStatus: "riding",
  statusEmoji: "🛵",
  avatarColor: "teal",
  backgroundKey: "forest",
};

const travelStatusOptions: Array<{ id: ApiTripMemberTravelStatus; label: string; emoji: string }> = [
  { id: "riding", label: "Đang chạy", emoji: "🛵" },
  { id: "resting", label: "Đang nghỉ", emoji: "☕" },
  { id: "need-help", label: "Cần hỗ trợ", emoji: "🆘" },
  { id: "offline", label: "Tạm offline", emoji: "🌙" },
];

const avatarColorOptions: ApiTripMemberAvatarColor[] = ["teal", "sky", "green", "amber", "rose", "violet"];

const backgroundOptions: Array<{ id: ApiTripMemberBackgroundKey; label: string }> = [
  { id: "forest", label: "Rừng núi" },
  { id: "coast", label: "Biển" },
  { id: "mountain", label: "Đèo" },
  { id: "night", label: "Đêm" },
  { id: "sunrise", label: "Bình minh" },
];

const categories = [
  { id: "fuel", label: "Xăng", icon: Fuel },
  { id: "food", label: "Ăn uống", icon: ReceiptText },
  { id: "hotel", label: "Nghỉ ngơi", icon: Bike },
  { id: "border", label: "Cửa khẩu", icon: ShieldCheck },
];

const mapMarkerKinds: Array<{ id: ApiMapMarkerKind; label: string }> = [
  { id: "ping", label: "Ping" },
  { id: "meetup", label: "Hẹn gặp" },
  { id: "fuel", label: "Đổ xăng" },
  { id: "food", label: "Quán ăn" },
  { id: "lodging", label: "Ngủ nghỉ" },
  { id: "repair", label: "Sửa xe" },
  { id: "warning", label: "Cảnh báo" },
];

const poiFilters: Array<{ id: ApiTripPoiKind; label: string }> = [
  { id: "food", label: "Quán ăn" },
  { id: "lodging", label: "Khách sạn" },
  { id: "fuel", label: "Cây xăng" },
];

const locationShareIntervalMs = 15_000;
const mapIconBasePath = "/map-icons";
type TrailIconKind = ApiMapMarkerKind | ApiTripPoiKind | "member" | "sos";
type SavedPlaceSource = "recent" | "poi" | "marker";

type SavedPlace = {
  id: string;
  label: string;
  subtitle: string;
  source: SavedPlaceSource;
  coordinate: ApiGeoPoint | null;
  lastUsedAt: string;
  useCount: number;
};

const savedPlacesStorageKey = "trailledger:saved-places:v1";
const maxSavedPlaces = 18;
const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
const googleMapsScriptId = "trailledger-google-maps-js";
let googleMapsLoaderPromise: Promise<typeof google> | null = null;
const vietnamSeaLabels = [
  { label: "Quần đảo Hoàng Sa", lat: 16.55, lng: 112.35 },
  { label: "Quần đảo Trường Sa", lat: 10.2, lng: 114.2 },
] as const;

type GoogleWindow = Window & { google?: typeof google };

/**
 * Returns the icon path for a saved/shared map marker.
 */
function mapMarkerIconPath(kind: ApiMapMarkerKind): string {
  return trailIconPath(kind);
}

/**
 * Returns the icon path for a route POI.
 */
function poiIconPath(kind: ApiTripPoiKind): string {
  return trailIconPath(kind);
}

/**
 * Builds a public asset path for a TrailLedger map icon.
 */
function trailIconPath(kind: TrailIconKind): string {
  return `${mapIconBasePath}/${kind}.svg`;
}

/**
 * Normalizes free-form place text before matching or saving it.
 */
function normalizePlaceText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Creates a stable local id for a saved place.
 */
function savedPlaceKey(label: string, coordinate?: ApiGeoPoint | null): string {
  const normalizedLabel = normalizePlaceText(label).toLowerCase();

  if (!coordinate) {
    return `text:${normalizedLabel}`;
  }

  return `geo:${coordinate.lat.toFixed(5)},${coordinate.lng.toFixed(5)}:${normalizedLabel}`;
}

/**
 * Reads recent/saved places from localStorage.
 */
function readSavedPlaces(): SavedPlace[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(savedPlacesStorageKey);

    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue) as SavedPlace[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((place) => typeof place?.label === "string" && place.label.trim())
      .slice(0, maxSavedPlaces);
  } catch {
    return [];
  }
}

/**
 * Stores recent/saved places on the current browser.
 */
function writeSavedPlaces(places: SavedPlace[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(savedPlacesStorageKey, JSON.stringify(places.slice(0, maxSavedPlaces)));
  } catch {
    // Local storage can be blocked in private mode; suggestions simply become session-only.
  }
}

/**
 * Inserts or updates a saved place and keeps the most useful places at the top.
 */
function mergeSavedPlace(current: SavedPlace[], nextPlace: Omit<SavedPlace, "id" | "lastUsedAt" | "useCount">): SavedPlace[] {
  const label = normalizePlaceText(nextPlace.label);

  if (!label) {
    return current;
  }

  const id = savedPlaceKey(label, nextPlace.coordinate);
  const existing = current.find((place) => place.id === id);
  const mergedPlace: SavedPlace = {
    id,
    label,
    subtitle: nextPlace.subtitle,
    source: nextPlace.source,
    coordinate: nextPlace.coordinate,
    lastUsedAt: new Date().toISOString(),
    useCount: (existing?.useCount ?? 0) + 1,
  };

  return [mergedPlace, ...current.filter((place) => place.id !== id)].slice(0, maxSavedPlaces);
}

/**
 * Converts a shared map marker into a saved-place suggestion.
 */
function savedPlaceFromMarker(marker: ApiMapMarker): SavedPlace {
  return {
    id: savedPlaceKey(marker.label, { lat: marker.latitude, lng: marker.longitude }),
    label: marker.label,
    subtitle: mapMarkerKindLabel(marker.kind),
    source: "marker",
    coordinate: { lat: marker.latitude, lng: marker.longitude },
    lastUsedAt: marker.createdAt,
    useCount: 1,
  };
}

/**
 * Converts a POI near the route into a saved-place suggestion.
 */
function savedPlaceFromPoi(poi: ApiTripPoi): SavedPlace {
  return {
    id: savedPlaceKey(poi.name, { lat: poi.latitude, lng: poi.longitude }),
    label: poi.name,
    subtitle: `${poiKindLabel(poi.kind)} · ${poi.distanceFromRouteKm.toFixed(1)} km`,
    source: "poi",
    coordinate: { lat: poi.latitude, lng: poi.longitude },
    lastUsedAt: "",
    useCount: 1,
  };
}

/**
 * Filters and sorts place suggestions for origin/destination inputs.
 */
function buildPlaceSuggestions(query: string, places: SavedPlace[]): SavedPlace[] {
  const normalizedQuery = normalizePlaceText(query).toLowerCase();

  return places
    .filter((place) => {
      if (!normalizedQuery) {
        return place.source === "recent" || place.source === "marker";
      }

      return `${place.label} ${place.subtitle}`.toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "recent" ? -1 : right.source === "recent" ? 1 : 0;
      }

      return right.useCount - left.useCount;
    })
    .slice(0, 6);
}

/**
 * Returns the UI label for where a place suggestion came from.
 */
function placeSourceLabel(source: SavedPlaceSource): string {
  if (source === "recent") {
    return "Gần đây";
  }

  if (source === "marker") {
    return "Đã lưu";
  }

  return "Gần tuyến";
}

/**
 * Loads the Google Maps JavaScript SDK once when a public API key is configured.
 */
function loadGoogleMaps(): Promise<typeof google> {
  if (!googleMapsApiKey || typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps API key is missing."));
  }

  const googleWindow = window as GoogleWindow;

  if (googleWindow.google?.maps?.Map && googleWindow.google.maps.places?.SearchBox) {
    return Promise.resolve(googleWindow.google);
  }

  if (googleMapsLoaderPromise) {
    return googleMapsLoaderPromise;
  }

  googleMapsLoaderPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(googleMapsScriptId) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        const loadedGoogle = (window as GoogleWindow).google;
        loadedGoogle ? resolve(loadedGoogle) : reject(new Error("Google Maps did not initialize."));
      });
      existingScript.addEventListener("error", () => reject(new Error("Could not load Google Maps.")));
      return;
    }

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: googleMapsApiKey,
      libraries: "places",
      language: "vi",
      region: "VN",
    });

    script.id = googleMapsScriptId;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.onload = () => {
      const loadedGoogle = (window as GoogleWindow).google;
      loadedGoogle ? resolve(loadedGoogle) : reject(new Error("Google Maps did not initialize."));
    };
    script.onerror = () => reject(new Error("Could not load Google Maps."));
    document.head.appendChild(script);
  });

  return googleMapsLoaderPromise;
}

/**
 * Renders an icon image for map markers, POIs, and member pins.
 */
function TrailMapIcon({ kind, className = "trail-map-icon" }: { kind: TrailIconKind; className?: string }) {
  return <img className={className} src={trailIconPath(kind)} alt="" aria-hidden="true" />;
}

/**
 * Picks a stable route color from a user/route id.
 */
function memberRouteColor(seed: string): string {
  const palette = ["#7c3aed", "#f97316", "#0ea5e9", "#db2777", "#16a34a", "#d97706", "#0891b2"];
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }

  return palette[hash % palette.length]!;
}

/**
 * Main authenticated workspace for TrailLedger. It coordinates trip loading,
 * map planning, group presence, expenses, chat, and recap state while delegating
 * focused UI sections to smaller components below.
 */
export function ExpensePlanner() {
  // Main screen after authentication.
  // This component currently coordinates four product areas:
  // 1. Map, route planning, and member GPS.
  // 2. Expenses and split-bill.
  // 3. Group presence and chat.
  // 4. Trip recap, archive, and delete.
  // The state groups below follow those product areas so future refactors can split them safely.
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [activeTab, setActiveTab] = useState<MobileTab>("route");
  const [isAppRailOpen, setIsAppRailOpen] = useState(false);
  const [isAppRailMinimized, setIsAppRailMinimized] = useState(false);
  const [appRailSide, setAppRailSide] = useState<"left" | "right">("left");

  // Core trip data comes from the backend/Postgres.
  // Live sync refreshes these sections selectively so map interactions are not reset unnecessarily.
  const [expenses, setExpenses] = useState<ApiExpense[]>([]);
  const [members, setMembers] = useState<TripMemberView[]>([]);
  const [trips, setTrips] = useState<ApiTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState(defaultTripId);
  const [balances, setBalances] = useState<ApiBalance[]>([]);
  const [settlements, setSettlements] = useState<ApiSettlement[]>([]);
  const [mapMarkers, setMapMarkers] = useState<ApiMapMarker[]>([]);
  const [memberRoutes, setMemberRoutes] = useState<ApiMemberRoute[]>([]);
  const [visibleMemberRouteIds, setVisibleMemberRouteIds] = useState<string[]>([]);
  const [tripPois, setTripPois] = useState<ApiTripPoi[]>([]);
  const [selectedPoiKinds, setSelectedPoiKinds] = useState<ApiTripPoiKind[]>(["food", "lodging", "fuel"]);

  // memberLocations stores the latest GPS point for each sharing member.
  // presenceUsers only describes who is online/sharing; it does not replace location data.
  const [memberLocations, setMemberLocations] = useState<ApiMemberLocation[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<ApiPresenceUser[]>([]);
  const [presenceNotice, setPresenceNotice] = useState<PresenceNotice | null>(null);
  const [selectedPresenceUserId, setSelectedPresenceUserId] = useState<string | null>(null);
  const [locationAddresses, setLocationAddresses] = useState<Record<string, ApiMemberLocationAddress>>({});
  const [isResolvingAddressFor, setIsResolvingAddressFor] = useState<string | null>(null);
  const [focusedLocationRequest, setFocusedLocationRequest] = useState<FocusedLocationRequest | null>(null);
  const [chatMessages, setChatMessages] = useState<ApiTripMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Route endpoints can be plain text or exact coordinates selected from saved places, POIs, or GPS.
  // The backend prefers coordinates because they are more reliable than free-form place names.
  const [routePlan, setRoutePlan] = useState<ApiRoutePlan | null>(null);
  const [routeOrigin, setRouteOrigin] = useState("");
  const [routeOriginCoordinate, setRouteOriginCoordinate] = useState<ApiGeoPoint | null>(null);
  const [routeDestination, setRouteDestination] = useState("");
  const [routeDestinationCoordinate, setRouteDestinationCoordinate] = useState<ApiGeoPoint | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [isPlacingMapMarker, setIsPlacingMapMarker] = useState(false);
  const [pendingMapMarker, setPendingMapMarker] = useState<ApiGeoPoint | null>(null);
  const [mapMarkerLabel, setMapMarkerLabel] = useState("");
  const [mapMarkerKind, setMapMarkerKind] = useState<ApiMapMarkerKind>("ping");
  const [isSavingMapMarker, setIsSavingMapMarker] = useState(false);
  const [isSavingMemberRoute, setIsSavingMemberRoute] = useState(false);
  const [deletingMemberRouteId, setDeletingMemberRouteId] = useState<string | null>(null);
  const [deletingMapMarkerId, setDeletingMapMarkerId] = useState<string | null>(null);

  // Expense form state. The client builds a split payload for UX,
  // but the backend validates and calculates the split again instead of trusting the browser.
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("VND");
  const [payerId, setPayerId] = useState("");
  const [category, setCategory] = useState(categories[1]?.id ?? "food");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [showExpenseAdvanced, setShowExpenseAdvanced] = useState(false);

  // Offline queue lets users save expenses while the network is down.
  // When the browser comes back online, syncQueuedExpenses sends each item with a clientMutationId
  // so the backend can avoid duplicate writes.
  const [offlineReady, setOfflineReady] = useState(false);
  const [isUsingOfflineRoute, setIsUsingOfflineRoute] = useState(false);
  const [queuedExpenseCount, setQueuedExpenseCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isLiveSyncConnected, setIsLiveSyncConnected] = useState(false);
  const [lastLiveSyncEvent, setLastLiveSyncEvent] = useState<ApiTripLiveEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingExpenses, setIsSyncingExpenses] = useState(false);
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [isLoadingPois, setIsLoadingPois] = useState(false);
  const [isUpdatingTripStatus, setIsUpdatingTripStatus] = useState(false);
  const [isDeletingTrip, setIsDeletingTrip] = useState(false);
  const [isUsingCurrentLocation, setIsUsingCurrentLocation] = useState(false);
  const [isSharingLocation, setIsSharingLocation] = useState(false);
  const [locationShareStatus, setLocationShareStatus] = useState<LocationShareStatus>("idle");
  const [apiError, setApiError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [profileDraft, setProfileDraft] = useState<MemberProfileDraft>(defaultProfileDraft);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [showEntryAnimation, setShowEntryAnimation] = useState(false);
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<ApiTripRole>("viewer");

  // Refs hold technical flags that should not trigger re-renders:
  // - prevent overlapping loadTripData calls.
  // - detect whether the route form is dirty so background refreshes do not overwrite user input.
  // - keep the geolocation watch id so GPS sharing can be stopped cleanly.
  const loadTripDataInFlightRef = useRef(false);
  const routeFormDirtyRef = useRef(false);
  const routePlanSignatureRef = useRef("");
  const locationShareWatchIdRef = useRef<number | null>(null);
  const lastSharedPositionAtRef = useRef(0);
  const chatMessageListRef = useRef<HTMLDivElement | null>(null);

  const placeSuggestions = useMemo(() => {
    // Place suggestions are merged from three sources:
    // - recent user searches.
    // - saved map markers.
    // - route POIs such as food, lodging, and fuel.
    // A Map removes duplicates before the list is displayed.
    const byId = new globalThis.Map<string, SavedPlace>();

    for (const place of savedPlaces) {
      byId.set(place.id, place);
    }

    for (const marker of mapMarkers) {
      const place = savedPlaceFromMarker(marker);
      byId.set(place.id, byId.get(place.id) ?? place);
    }

    for (const poi of tripPois) {
      const place = savedPlaceFromPoi(poi);
      byId.set(place.id, byId.get(place.id) ?? place);
    }

    return Array.from(byId.values());
  }, [mapMarkers, savedPlaces, tripPois]);

  const rememberPlace = useCallback((place: Omit<SavedPlace, "id" | "lastUsedAt" | "useCount">) => {
    setSavedPlaces((current) => {
      const nextPlaces = mergeSavedPlace(current, place);
      writeSavedPlaces(nextPlaces);
      return nextPlaces;
    });
  }, []);

  /**
   * Applies a new route plan to the map, form fields, cache, and offline state.
   */
  function applyRoutePlan(nextRoutePlan: ApiRoutePlan, options: { cache?: boolean; fromCache?: boolean; tripId?: string } = {}) {
    // A route plan update must keep the map, route form, cache, and offline status in sync.
    // routePlanSignatureRef prevents background refreshes from re-applying the same route and causing map jitter.
    const safeRoutePlan = normalizeRoutePlan(nextRoutePlan);

    routePlanSignatureRef.current = routePlanSignature(safeRoutePlan);
    routeFormDirtyRef.current = false;
    setRoutePlan(safeRoutePlan);
    setRouteOrigin(safeRoutePlan.origin);
    setRouteOriginCoordinate(null);
    setRouteDestination(safeRoutePlan.destination);
    setRouteDestinationCoordinate(null);
    setFocusedLocationRequest(null);
    setOfflineReady(true);
    setIsUsingOfflineRoute(Boolean(options.fromCache));

    if (options.cache !== false) {
      writeCachedRoutePlan(safeRoutePlan, options.tripId ?? selectedTripId);
    }
  }

  /**
   * Refreshes the visible count of expenses waiting for offline sync.
   */
  function refreshQueuedExpenseCount() {
    setQueuedExpenseCount(readQueuedExpenses().length);
  }

  const loadTripData = useCallback(async (options: { silent?: boolean } = {}) => {
    // Loads the full workspace for the selected trip.
    // silent=true is used by background refresh/live sync so the UI updates without a full-screen loading state.
    // loadTripDataInFlightRef prevents SSE events and timers from launching overlapping API batches.
    if (loadTripDataInFlightRef.current) {
      return;
    }

    loadTripDataInFlightRef.current = true;

    if (options.silent) {
      setIsRefreshingData(true);
    } else {
      setIsLoading(true);
      setApiError(null);
    }

    const cachedRoutePlan = readCachedRoutePlan(selectedTripId);

    const canUpdateRouteForm = !options.silent || !routeFormDirtyRef.current;

    if (cachedRoutePlan && canUpdateRouteForm && (!options.silent || routePlanSignatureRef.current !== routePlanSignature(cachedRoutePlan))) {
      applyRoutePlan(cachedRoutePlan, { cache: false, fromCache: true });
    }

    try {
      const nextTrips = await fetchTrips();
      setTrips(nextTrips);

      if (!nextTrips.length) {
        setMembers([]);
        setExpenses([]);
        setBalances([]);
        setSettlements([]);
        setMapMarkers([]);
        setMemberRoutes([]);
        setTripPois([]);
        setMemberLocations([]);
        setPresenceUsers([]);
        setChatMessages([]);
        routePlanSignatureRef.current = "";
        setRoutePlan(null);
        setOfflineReady(false);
        setLastSyncedAt(new Date());
        return;
      }

      if (!nextTrips.some((trip) => trip.id === selectedTripId)) {
        const nextTripId = nextTrips[0]!.id;
        setSelectedTripId(nextTripId);
        window.localStorage.setItem(selectedTripCacheKey(), nextTripId);
        setLastSyncedAt(new Date());
        return;
      }

      const [nextMembers, nextExpenses, result, nextRoutePlan, nextLocations, nextPresence, nextMessages, nextMapMarkers, nextMemberRoutes] = await Promise.all([
        fetchTripMembers(selectedTripId),
        fetchExpenses(selectedTripId),
        fetchSettlementResult(selectedTripId),
        fetchRoutePlan(selectedTripId),
        fetchTripLocations(selectedTripId).catch(() => []),
        fetchTripPresence(selectedTripId).catch(() => []),
        fetchTripMessages(selectedTripId).catch(() => []),
        fetchTripMapMarkers(selectedTripId).catch(() => []),
        fetchMemberRoutes(selectedTripId).catch(() => []),
      ]);
      const mappedMembers = nextMembers.map(mapTripMember);
      const activeMemberIds = mappedMembers.filter((member) => member.active).map((member) => member.id);
      setMembers(mappedMembers);
      setPayerId((current) => (current && activeMemberIds.includes(current) ? current : (activeMemberIds[0] ?? "")));
      setParticipantIds((current) => {
        const valid = current.filter((id) => activeMemberIds.includes(id));
        return valid.length ? valid : activeMemberIds;
      });
      setExpenses(nextExpenses);
      setBalances(result.balances);
      setSettlements(result.settlements);
      setMemberLocations(nextLocations);
      setPresenceUsers(nextPresence);
      setChatMessages(nextMessages);
      setMapMarkers(nextMapMarkers);
      setMemberRoutes(nextMemberRoutes);
      const normalizedRoutePlan = normalizeRoutePlan(nextRoutePlan);
      const nextRouteSignature = routePlanSignature(normalizedRoutePlan);

      if (canUpdateRouteForm && (!options.silent || routePlanSignatureRef.current !== nextRouteSignature)) {
        applyRoutePlan(normalizedRoutePlan, { tripId: selectedTripId });
      } else {
        writeCachedRoutePlan(normalizedRoutePlan, selectedTripId);
      }
      setLastSyncedAt(new Date());
    } catch (error) {
      const cached = cachedRoutePlan ?? readCachedRoutePlan(selectedTripId);

      if (cached && canUpdateRouteForm) {
        applyRoutePlan(cached, { cache: false, fromCache: true });
        if (!options.silent) {
          setApiError("Đang dùng tuyến đã lưu trong máy vì API tạm thời không kết nối được");
        }
      } else {
        if (!options.silent) {
          setApiError(error instanceof Error ? error.message : "Không kết nối được API");
        }
      }
    } finally {
      loadTripDataInFlightRef.current = false;
      if (options.silent) {
        setIsRefreshingData(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [selectedTripId]);

  const loadTripPois = useCallback(async (targetTripId = selectedTripId, kinds = selectedPoiKinds) => {
    if (!targetTripId || !kinds.length) {
      setTripPois([]);
      return;
    }

    setIsLoadingPois(true);

    try {
      setTripPois(await fetchTripPois(targetTripId, kinds));
    } catch {
      setTripPois([]);
    } finally {
      setIsLoadingPois(false);
    }
  }, [selectedPoiKinds, selectedTripId]);

  const loadTripLocations = useCallback(async (targetTripId = selectedTripId) => {
    try {
      setMemberLocations(await fetchTripLocations(targetTripId));
    } catch {
      // GPS sharing is helpful, but it should not block the rest of the trip screen.
    }
  }, [selectedTripId]);

  const loadTripPresence = useCallback(async (targetTripId = selectedTripId) => {
    try {
      setPresenceUsers(await fetchTripPresence(targetTripId));
    } catch {
      // Presence is live convenience data; stale presence should not block trip work.
    }
  }, [selectedTripId]);

  const loadTripMessages = useCallback(async (targetTripId = selectedTripId) => {
    try {
      setChatMessages(await fetchTripMessages(targetTripId));
    } catch {
      // Chat history should refresh when possible, but the trip must remain usable offline.
    }
  }, [selectedTripId]);

  const loadTripMapMarkers = useCallback(async (targetTripId = selectedTripId) => {
    try {
      setMapMarkers(await fetchTripMapMarkers(targetTripId));
    } catch {
      // Map markers are shared hints; stale markers should not block route work.
    }
  }, [selectedTripId]);

  const loadMemberRoutes = useCallback(async (targetTripId = selectedTripId) => {
    try {
      setMemberRoutes(await fetchMemberRoutes(targetTripId));
    } catch {
      // Member routes are a shared overlay; the main trip remains usable if this refresh fails.
    }
  }, [selectedTripId]);

  const syncQueuedExpenses = useCallback(async () => {
    if (!currentUser || isSyncingExpenses || !navigator.onLine) {
      return;
    }

    const queuedExpenses = readQueuedExpenses();

    if (!queuedExpenses.length) {
      refreshQueuedExpenseCount();
      return;
    }

    setIsSyncingExpenses(true);
    const remaining: OfflineExpenseQueueItem[] = [];
    let syncedCount = 0;

    for (const item of queuedExpenses) {
      try {
        await createExpense(item.payload, item.tripId);
        syncedCount += 1;
      } catch (error) {
        remaining.push(item);

        if (!shouldQueueExpense(error)) {
          break;
        }
      }
    }

    writeQueuedExpenses([...remaining, ...queuedExpenses.slice(syncedCount + remaining.length)]);
    refreshQueuedExpenseCount();
    setIsSyncingExpenses(false);

    if (syncedCount > 0) {
      await loadTripData({ silent: true });
    }
  }, [currentUser, isSyncingExpenses, loadTripData]);

  useEffect(() => {
    // Initialize device-local preferences.
    // These values do not change the online database: theme, recent places, offline expense queue, and last selected trip.
    const savedTheme = window.localStorage.getItem("trail-ledger-theme");
    const nextTheme = savedTheme === "light" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    setSavedPlaces(readSavedPlaces());
    refreshQueuedExpenseCount();

    const savedTripId = window.localStorage.getItem(selectedTripCacheKey());

    if (savedTripId) {
      setSelectedTripId(savedTripId);
    }
  }, []);

  useEffect(() => {
    // "Remember login / auto-enter app" behavior.
    // If the user did not enable it, the app stays on the login screen instead of jumping into the cockpit.
    let mounted = true;

    if (!shouldAutoEnterApp()) {
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    void getCurrentFirebaseUser()
      .then((firebaseUser) => {
        if (!mounted) {
          return;
        }

        if (!firebaseUser) {
          clearAutoEnterApp();
          setIsLoading(false);
          return;
        }

        void fetchMe()
          .then((user) => {
            if (mounted) {
              setCurrentUser(user);
            }
          })
          .catch(() => {
            if (mounted) {
              clearAutoEnterApp();
              setCurrentUser(null);
              setIsLoading(false);
            }
          });
      })
      .catch(() => {
        if (mounted) {
          clearAutoEnterApp();
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setShowEntryAnimation(false);
      return;
    }

    setShowEntryAnimation(true);
    const entryTimer = window.setTimeout(() => setShowEntryAnimation(false), 1800);

    return () => {
      window.clearTimeout(entryTimer);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    // Background refresh runs only when the tab is visible, online, and not currently saving/planning.
    // This keeps group data fresh without constantly resetting the map while the rider is interacting with it.
    if (!currentUser) {
      return;
    }

    void loadTripData();
  }, [currentUser, loadTripData]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    void syncQueuedExpenses();

    window.addEventListener("online", syncQueuedExpenses);

    return () => {
      window.removeEventListener("online", syncQueuedExpenses);
    };
  }, [currentUser, syncQueuedExpenses]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    function refreshWhenReady() {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      if (!navigator.onLine || isLoading || isRefreshingData || isSaving || isCreatingTrip || isPlanningRoute || isSyncingExpenses) {
        return;
      }

      void loadTripData({ silent: true });
    }

    const intervalId = window.setInterval(refreshWhenReady, 30000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshWhenReady();
      }
    }

    window.addEventListener("online", refreshWhenReady);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", refreshWhenReady);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentUser, isCreatingTrip, isLoading, isPlanningRoute, isRefreshingData, isSaving, isSyncingExpenses, loadTripData]);

  const totalVnd = useMemo(
    () => expenses.reduce((sum, expense) => sum + toVnd(Number(expense.money.amount), expense.money.currency), 0),
    [expenses],
  );
  const activeMembers = useMemo(() => members.filter((member) => member.active), [members]);
  const currentMember = currentUser ? activeMembers.find((member) => member.id === currentUser.id) ?? null : null;
  const currentTripRole = activeMembers.find((member) => member.id === currentUser?.id)?.role ?? "viewer";
  const canManageTripMembers = currentTripRole === "owner";
  const isCurrentTripMember = Boolean(currentUser && activeMembers.some((member) => member.id === currentUser.id));
  const canCreateMemberRoute = isCurrentTripMember;
  const canManageMemberRoutes = currentTripRole === "owner";
  const activeTrip = trips.find((trip) => trip.id === selectedTripId);
  const visibleMemberRouteSet = useMemo(() => new Set(visibleMemberRouteIds), [visibleMemberRouteIds]);

  useEffect(() => {
    if (!currentMember) {
      setProfileDraft(defaultProfileDraft);
      return;
    }

    setProfileDraft(memberToProfileDraft(currentMember));
  }, [
    currentMember?.id,
    currentMember?.name,
    currentMember?.phoneNumber,
    currentMember?.homeBase,
    currentMember?.travelStatus,
    currentMember?.statusEmoji,
    currentMember?.avatarColor,
    currentMember?.backgroundKey,
  ]);

  const syncStatusValue = queuedExpenseCount
    ? `Cho ${queuedExpenseCount}`
    : isLiveSyncConnected
      ? "Live"
    : isRefreshingData
      ? "Đang cập nhật"
      : lastSyncedAt
        ? formatSyncTime(lastSyncedAt)
        : isLoading
          ? "Đang tải"
          : isUsingOfflineRoute
            ? "Offline"
            : offlineReady
              ? "Đã lưu"
              : "Chưa lưu";

  useEffect(() => {
    if (!currentUser || !activeTrip?.id || !routePlan || routePlan.totalDistanceKm <= 0) {
      setTripPois([]);
      return;
    }

    void loadTripPois(activeTrip.id, selectedPoiKinds);
  }, [activeTrip?.id, currentUser, loadTripPois, routePlan?.generatedAt, routePlan?.totalDistanceKm, selectedPoiKinds]);

  useEffect(() => {
    // New member routes are visible by default.
    // Routes that the user manually hid stay hidden as long as the same route id still exists.
    setVisibleMemberRouteIds((current) => {
      const currentSet = new Set(current);
      const nextIds = memberRoutes.map((route) => route.id);
      const nextVisible = nextIds.filter((id) => currentSet.has(id));
      const newIds = nextIds.filter((id) => !currentSet.has(id));
      return [...nextVisible, ...newIds];
    });
  }, [memberRoutes]);

  useEffect(() => {
    // Live sync events only announce that something changed.
    // The client then refreshes only the affected section: chat, GPS, markers, member routes, or trip data.
    // This is lighter and smoother than reloading the whole cockpit after every event.
    if (!currentUser || !activeTrip?.id) {
      setIsLiveSyncConnected(false);
      return;
    }

    let refreshTimeout: number | null = null;
    const unsubscribe = subscribeToTripEvents(activeTrip.id, {
      onOpen: () => {
        setIsLiveSyncConnected(true);
        void loadTripPresence(activeTrip.id);
        void loadTripMessages(activeTrip.id);
        void loadTripMapMarkers(activeTrip.id);
        void loadMemberRoutes(activeTrip.id);
      },
      onError: () => {
        setIsLiveSyncConnected(false);
      },
      onEvent: (event) => {
        if (event.tripId !== activeTrip.id) {
          return;
        }

        setLastLiveSyncEvent(event);

        if (event.type === "presence_joined" || event.type === "presence_left") {
          void loadTripPresence(activeTrip.id);

          if (event.actorUserId !== currentUser.id) {
            const displayName = event.actorDisplayName || "Thành viên";
            setPresenceNotice({
              id: event.id,
              message: event.type === "presence_joined" ? `${displayName} vừa vào phòng` : `${displayName} vừa rời phòng`,
              tone: event.type === "presence_joined" ? "join" : "leave",
            });
          }

          return;
        }

        if (event.type === "message_created") {
          void loadTripMessages(activeTrip.id);

          if (event.actorUserId !== currentUser.id) {
            if (!isChatOpen) {
              setUnreadChatCount((current) => current + 1);
            }

            const displayName = event.actorDisplayName || "Thành viên";
            setPresenceNotice({
              id: event.id,
              message: `${displayName} vừa gửi tin nhắn`,
              tone: "message",
            });
          }

          return;
        }

        if (event.type === "map_marker_changed") {
          void loadTripMapMarkers(activeTrip.id);
          return;
        }

        if (event.type === "member_route_changed") {
          void loadMemberRoutes(activeTrip.id);

          if (event.actorUserId !== currentUser.id) {
            const displayName = event.actorDisplayName || "Thành viên";
            setPresenceNotice({
              id: event.id,
              message: `${displayName} vừa cập nhật tuyến riêng`,
              tone: "join",
            });
          }

          return;
        }

        if (event.type === "trip_changed" || event.type === "trip_deleted") {
          void loadTripData({ silent: true });
          return;
        }

        if (refreshTimeout) {
          window.clearTimeout(refreshTimeout);
        }

        refreshTimeout = window.setTimeout(() => {
          if (event.type === "location_updated" || event.type === "location_stopped") {
            void loadTripLocations(activeTrip.id);
            return;
          }

          void loadTripData({ silent: true });
        }, 250);
      },
    });

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      setIsLiveSyncConnected(false);
      unsubscribe();
    };
  }, [activeTrip?.id, currentUser, isChatOpen, loadMemberRoutes, loadTripData, loadTripLocations, loadTripMapMarkers, loadTripMessages, loadTripPresence]);

  useEffect(() => {
    return () => {
      clearLocationShareWatch();
    };
  }, []);

  useEffect(() => {
    if (!presenceNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPresenceNotice(null);
    }, 4200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [presenceNotice]);

  useEffect(() => {
    if (!isChatOpen) {
      return;
    }

    setUnreadChatCount(0);
    chatMessageListRef.current?.scrollTo({
      top: chatMessageListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages, isChatOpen]);

  /**
   * Switches between light and dark mode and persists the preference locally.
   */
  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("trail-ledger-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  /**
   * Opens or closes the floating trip chat widget.
   */
  function handleToggleChat() {
    const nextOpen = !isChatOpen;
    setIsChatOpen(nextOpen);

    if (nextOpen) {
      // Opening chat marks messages as read and refreshes once in case the SSE stream missed an event.
      setUnreadChatCount(0);
      setChatError(null);

      if (activeTrip?.id) {
        void loadTripMessages(activeTrip.id);
      }
    }
  }

  /**
   * Sends a chat message after trimming and validating that the user is in an active trip.
   */
  async function handleSendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeTrip?.id || !currentUser || isSendingMessage) {
      return;
    }

    const nextBody = chatDraft.trim();

    if (!nextBody) {
      return;
    }

    // The message is added to the UI only after the backend confirms it.
    // This avoids displaying fake sent messages when auth, membership, or validation fails.
    setIsSendingMessage(true);
    setChatError(null);

    try {
      const message = await sendTripMessage(nextBody, activeTrip.id);
      setChatMessages((current) => appendUniqueMessages(current, [message]));
      setChatDraft("");
      setIsChatOpen(true);
      setUnreadChatCount(0);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Không gửi được tin nhắn");
    } finally {
      setIsSendingMessage(false);
    }
  }

  /**
   * Toggles whether a member is included in the current expense split.
   */
  function toggleParticipant(memberId: string) {
    setParticipantIds((current) => {
      if (current.includes(memberId)) {
        return current.length === 1 ? current : current.filter((id) => id !== memberId);
      }

      return [...current, memberId];
    });
  }

  /**
   * Updates the percentage/share value for one split participant.
   */
  function updateSplitValue(memberId: string, value: string) {
    setSplitValues((current) => ({
      ...current,
      [memberId]: value,
    }));
  }

  /**
   * Stops the browser geolocation watcher used for sharing GPS.
   */
  function clearLocationShareWatch() {
    // watchPosition keeps running in the browser until it is explicitly cleared.
    // Always clear it on stop/logout/unmount so the app does not keep sending GPS in the background.
    if (locationShareWatchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(locationShareWatchIdRef.current);
    }

    locationShareWatchIdRef.current = null;
  }

  /**
   * Starts sharing the current browser GPS position with the trip.
   */
  function handleStartSharingLocation() {
    if (!currentUser || !selectedTripId) {
      return;
    }

    if (!("geolocation" in navigator)) {
      setLocationShareStatus("unavailable");
      setApiError("Trình duyệt không lấy được vị trí GPS");
      return;
    }

    if (locationShareWatchIdRef.current !== null) {
      return;
    }

    setApiError(null);
    setIsSharingLocation(true);
    setLocationShareStatus("starting");
    lastSharedPositionAtRef.current = 0;

    locationShareWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();

        // Browsers can emit GPS points very frequently.
        // Throttling to 15 seconds saves battery/API calls and prevents visible map jitter.
        if (lastSharedPositionAtRef.current && now - lastSharedPositionAtRef.current < locationShareIntervalMs) {
          return;
        }

        lastSharedPositionAtRef.current = now;
        void shareMyLocation(
          {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            speedMps: position.coords.speed,
            headingDegrees: position.coords.heading,
          },
          selectedTripId,
        )
          .then((location) => {
            const namedLocation = {
              ...location,
              displayName: location.displayName || currentUser.displayName,
            };
            setMemberLocations((current) => [namedLocation, ...current.filter((item) => item.userId !== namedLocation.userId)]);
            setLocationShareStatus("sharing");
          })
          .catch((error) => {
            setLocationShareStatus("error");
            setApiError(error instanceof Error ? error.message : "Không chia sẻ được vị trí");
          });
      },
      (error) => {
        clearLocationShareWatch();
        setIsSharingLocation(false);
        setLocationShareStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
        setApiError(error.code === error.PERMISSION_DENIED ? "Cần cho phép quyền vị trí để chia sẻ GPS" : "Không lấy được vị trí GPS");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    );
  }

  /**
   * Stops local GPS sharing and optionally tells the backend to remove the live point.
   */
  async function handleStopSharingLocation(options: { notifyServer?: boolean } = {}) {
    const shouldNotifyServer = options.notifyServer ?? true;
    const tripIdToStop = selectedTripId;
    const userIdToStop = currentUser?.id;

    clearLocationShareWatch();
    setIsSharingLocation(false);
    setLocationShareStatus("idle");

    if (userIdToStop) {
      setMemberLocations((current) => current.filter((item) => item.userId !== userIdToStop));
    }

    if (shouldNotifyServer && tripIdToStop) {
      try {
        await stopSharingMyLocation(tripIdToStop);
      } catch {
        // GPS points expire server-side, so a failed stop request is not dangerous.
        // The UI still stops immediately so the user is not stuck in a sharing state.
      }
    }
  }

  /**
   * Creates an expense or queues it locally when the app is offline.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount);

    const activeMemberIds = new Set(activeMembers.map((member) => member.id));

    if (
      !title.trim() ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0 ||
      participantIds.length === 0 ||
      !payerId ||
      !activeMemberIds.has(payerId) ||
      participantIds.some((id) => !activeMemberIds.has(id)) ||
      isSaving
    ) {
      return;
    }

    setIsSaving(true);
    setApiError(null);

    const clientMutationId = createClientMutationId();
    // clientMutationId is an idempotency key.
    // If the user goes offline and the app retries later, the backend can detect duplicate submissions.
    const expensePayload: ApiCreateExpensePayload = {
      title: title.trim(),
      category,
      paidByUserId: payerId,
      amount,
      currency,
      split: buildSplitPayload(splitMode, participantIds, splitValues),
      clientMutationId,
    };

    try {
      await createExpense(expensePayload, selectedTripId);
      setTitle("");
      setAmount("");
      setSplitValues({});
      setActiveTab("expenses");
      await loadTripData();
    } catch (error) {
      if (shouldQueueExpense(error)) {
        // Queue only network/server-temporary failures.
        // Validation or permission errors are not queued because retrying would fail again.
        const queuedExpense: OfflineExpenseQueueItem = {
          id: clientMutationId,
          tripId: selectedTripId,
          payload: expensePayload,
          createdAt: new Date().toISOString(),
        };
        enqueueExpense(queuedExpense);
        refreshQueuedExpenseCount();
        setExpenses((current) => [queuedExpenseToApiExpense(queuedExpense), ...current]);
        setTitle("");
        setAmount("");
        setSplitValues({});
        setActiveTab("expenses");
        setApiError("Đã lưu tạm chi phí trong máy. Có mạng lại sẽ tự động đồng bộ.");
      } else {
        setApiError(error instanceof Error ? error.message : "Không lưu được chi phí");
      }
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Updates the route origin text and marks the route form as user-edited.
   */
  function handleRouteOriginChange(value: string) {
    routeFormDirtyRef.current = true;
    setRouteOrigin(value);
    setRouteOriginCoordinate(null);
  }

  /**
   * Updates the route destination text and marks the route form as user-edited.
   */
  function handleRouteDestinationChange(value: string) {
    routeFormDirtyRef.current = true;
    setRouteDestination(value);
    setRouteDestinationCoordinate(null);
  }

  /**
   * Uses a saved place suggestion as the route origin.
   */
  function handleOriginPlaceSelect(place: SavedPlace) {
    routeFormDirtyRef.current = true;
    setRouteOrigin(place.label);
    setRouteOriginCoordinate(place.coordinate);
    rememberPlace({
      label: place.label,
      subtitle: place.subtitle,
      source: "recent",
      coordinate: place.coordinate,
    });
  }

  /**
   * Uses a saved place suggestion as the route destination.
   */
  function handleDestinationPlaceSelect(place: SavedPlace) {
    routeFormDirtyRef.current = true;
    setRouteDestination(place.label);
    setRouteDestinationCoordinate(place.coordinate);
    rememberPlace({
      label: place.label,
      subtitle: place.subtitle,
      source: "recent",
      coordinate: place.coordinate,
    });
  }

  /**
   * Requests a new route plan from the current origin/destination form values.
   */
  async function handlePlanRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if ((!routeOrigin.trim() && !routeOriginCoordinate) || !routeDestination.trim() || isPlanningRoute) {
      return;
    }

    setIsPlanningRoute(true);
    setApiError(null);

    try {
      // Send both the readable label and exact coordinates when coordinates are available.
      // The backend can route by coordinates while the UI still shows a friendly place name.
      const nextRoutePlan = await planRoute({
        origin: routeOriginCoordinate ? routeOrigin.trim() || "Vị trí của bạn" : routeOrigin.trim(),
        destination: routeDestination.trim(),
        ...(routeOriginCoordinate ? { originCoordinate: routeOriginCoordinate } : {}),
        ...(routeDestinationCoordinate ? { destinationCoordinate: routeDestinationCoordinate } : {}),
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      rememberPlace({
        label: nextRoutePlan.origin,
        subtitle: "Điểm đi đã dùng",
        source: "recent",
        coordinate: routeOriginCoordinate,
      });
      rememberPlace({
        label: nextRoutePlan.destination,
        subtitle: "Điểm đến đã dùng",
        source: "recent",
        coordinate: routeDestinationCoordinate,
      });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không vẽ được tuyến");
    } finally {
      setIsPlanningRoute(false);
    }
  }

  /**
   * Plans a route from the browser's current GPS position to the selected destination.
   */
  async function handlePlanRouteFromCurrentLocation() {
    if (!routeDestination.trim() || isPlanningRoute || isUsingCurrentLocation) {
      return;
    }

    if (!("geolocation" in navigator)) {
      setApiError("Trình duyệt không lấy được vị trí GPS");
      return;
    }

    setIsUsingCurrentLocation(true);
    setApiError(null);

    try {
      // This flow uses the browser's current GPS as the route origin.
      // Permission errors are handled separately so the user knows to enable location access.
      const position = await getCurrentBrowserPosition();
      const originCoordinate = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      setRouteOrigin("Vị trí của tôi");
      setRouteOriginCoordinate(originCoordinate);
      setIsPlanningRoute(true);

      const nextRoutePlan = await planRoute({
        origin: "Vị trí của tôi",
        destination: routeDestination.trim(),
        originCoordinate,
        ...(routeDestinationCoordinate ? { destinationCoordinate: routeDestinationCoordinate } : {}),
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      rememberPlace({
        label: nextRoutePlan.destination,
        subtitle: "Điểm đến đã dùng",
        source: "recent",
        coordinate: routeDestinationCoordinate,
      });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không lấy được vị trí hiện tại");
    } finally {
      setIsUsingCurrentLocation(false);
      setIsPlanningRoute(false);
    }
  }

  /**
   * Saves the current route as the current member's personal route layer.
   */
  async function handleSaveOwnerRoute() {
    if (!canCreateMemberRoute) {
      setApiError("Bạn cần là thành viên trong phòng để lưu tuyến riêng.");
      return;
    }

    if ((!routeOrigin.trim() && !routeOriginCoordinate) || !routeDestination.trim() || isSavingMemberRoute) {
      return;
    }

    setIsSavingMemberRoute(true);
    setApiError(null);

    try {
      // A member route is a personal route layer.
      // Other trip members can see it, but they can toggle it independently on their own map.
      const memberRoute = await createMemberRoute({
        origin: routeOriginCoordinate ? routeOrigin.trim() || "Vị trí của bạn" : routeOrigin.trim(),
        destination: routeDestination.trim(),
        ...(routeOriginCoordinate ? { originCoordinate: routeOriginCoordinate } : {}),
        ...(routeDestinationCoordinate ? { destinationCoordinate: routeDestinationCoordinate } : {}),
      }, selectedTripId);
      setMemberRoutes((current) => [memberRoute, ...current.filter((route) => route.id !== memberRoute.id)]);
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không lưu được tuyến riêng");
    } finally {
      setIsSavingMemberRoute(false);
    }
  }

  /**
   * Deletes a personal route layer when the user has permission.
   */
  async function handleDeleteMemberRoute(route: ApiMemberRoute) {
    if (route.userId !== currentUser?.id && currentTripRole !== "owner") {
      setApiError("Bạn không thể xóa tuyến riêng của người khác.");
      return;
    }

    setDeletingMemberRouteId(route.id);
    setApiError(null);

    try {
      await deleteMemberRoute(route.id, selectedTripId);
      setMemberRoutes((current) => current.filter((item) => item.id !== route.id));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không xóa được tuyến riêng");
    } finally {
      setDeletingMemberRouteId(null);
    }
  }

  /**
   * Shows or hides a member route layer on this user's map.
   */
  function handleToggleMemberRoute(routeId: string) {
    setVisibleMemberRouteIds((current) => (current.includes(routeId) ? current.filter((id) => id !== routeId) : [...current, routeId]));
  }

  /**
   * Plans a route from my current GPS location to another member's shared GPS point.
   */
  async function handlePlanRouteToMember(location: ApiMemberLocation) {
    if (isPlanningRoute || isUsingCurrentLocation) {
      return;
    }

    if (location.userId === currentUser?.id) {
      setApiError("Đây là vị trí của bạn.");
      return;
    }

    if (!("geolocation" in navigator)) {
      setApiError("Trình duyệt không lấy được vị trí GPS");
      return;
    }

    const destinationName = `Gặp ${location.displayName || "Thành viên"}`;

    setIsUsingCurrentLocation(true);
    setIsPlanningRoute(true);
    setApiError(null);

    try {
      // "Meet member" routes from my current GPS point to the member's latest shared GPS point.
      // It does not search by the member name because names are not map addresses.
      const position = await getCurrentBrowserPosition();
      const originCoordinate = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      const destinationCoordinate = {
        lat: location.latitude,
        lng: location.longitude,
      };

      setRouteOrigin("Vị trí của tôi");
      setRouteOriginCoordinate(originCoordinate);
      setRouteDestination(destinationName);
      setRouteDestinationCoordinate(destinationCoordinate);
      setFocusedLocationRequest({
        userId: location.userId,
        requestedAt: Date.now(),
      });

      const nextRoutePlan = await planRoute({
        origin: "Vị trí của tôi",
        destination: destinationName,
        originCoordinate,
        destinationCoordinate,
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      rememberPlace({
        label: destinationName,
        subtitle: "Thành viên trong nhóm",
        source: "recent",
        coordinate: destinationCoordinate,
      });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không vẽ được đường tới thành viên");
    } finally {
      setIsUsingCurrentLocation(false);
      setIsPlanningRoute(false);
    }
  }

  /**
   * Selects a member in the presence panel for quick actions.
   */
  function handleSelectPresenceUser(userId: string) {
    setSelectedPresenceUserId((current) => (current === userId ? null : userId));
  }

  /**
   * Requests the map to pan/zoom to a member's latest shared location.
   */
  function handleFocusMemberLocation(location: ApiMemberLocation) {
    setFocusedLocationRequest({
      userId: location.userId,
      requestedAt: Date.now(),
    });
    setActiveTab("route");
  }

  /**
   * Resolves a member's GPS coordinate into a readable address.
   */
  async function handleResolveMemberAddress(location: ApiMemberLocation) {
    setIsResolvingAddressFor(location.userId);
    setApiError(null);

    try {
      const address = await fetchMemberLocationAddress(location.userId, selectedTripId);
      setLocationAddresses((current) => ({
        ...current,
        [location.userId]: address,
      }));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không lấy được địa chỉ");
    } finally {
      setIsResolvingAddressFor(null);
    }
  }

  /**
   * Enables or disables "tap on map to choose marker position" mode.
   */
  function handleToggleMapMarkerPlacement() {
    setIsPlacingMapMarker((current) => !current);
    setPendingMapMarker(null);
  }

  /**
   * Stores the coordinate selected from the map for the marker form.
   */
  function handleMapMarkerPointSelected(point: ApiGeoPoint) {
    setPendingMapMarker(point);
    setIsPlacingMapMarker(false);
    setMapMarkerLabel((current) => current || mapMarkerKindLabel(mapMarkerKind));
  }

  /**
   * Creates a shared map marker at the selected coordinate.
   */
  async function handleCreateMapMarker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pendingMapMarker || isSavingMapMarker) {
      return;
    }

    setIsSavingMapMarker(true);
    setApiError(null);

    try {
      const marker = await createTripMapMarker({
        label: mapMarkerLabel.trim() || mapMarkerKindLabel(mapMarkerKind),
        kind: mapMarkerKind,
        latitude: pendingMapMarker.lat,
        longitude: pendingMapMarker.lng,
      }, selectedTripId);
      setMapMarkers((current) => [marker, ...current.filter((item) => item.id !== marker.id)]);
      setPendingMapMarker(null);
      setMapMarkerLabel("");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không tạo được điểm đánh dấu");
    } finally {
      setIsSavingMapMarker(false);
    }
  }

  /**
   * Deletes a shared map marker from the current trip.
   */
  async function handleDeleteMapMarker(marker: ApiMapMarker) {
    if (deletingMapMarkerId) {
      return;
    }

    setDeletingMapMarkerId(marker.id);
    setApiError(null);

    try {
      await deleteTripMapMarker(marker.id, selectedTripId);
      setMapMarkers((current) => current.filter((item) => item.id !== marker.id));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không xóa được điểm đánh dấu");
    } finally {
      setDeletingMapMarkerId(null);
    }
  }

  /**
   * Plans a route from current GPS to a saved/shared map marker.
   */
  async function handlePlanRouteToMapMarker(marker: ApiMapMarker) {
    if (isPlanningRoute || isUsingCurrentLocation) {
      return;
    }

    if (!("geolocation" in navigator)) {
      setApiError("Trình duyệt không lấy được vị trí GPS");
      return;
    }

    setIsUsingCurrentLocation(true);
    setIsPlanningRoute(true);
    setApiError(null);

    try {
      const position = await getCurrentBrowserPosition();
      const originCoordinate = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      const destinationCoordinate = {
        lat: marker.latitude,
        lng: marker.longitude,
      };

      setRouteOrigin("Vị trí của tôi");
      setRouteOriginCoordinate(originCoordinate);
      setRouteDestination(marker.label);
      setRouteDestinationCoordinate(destinationCoordinate);

      const nextRoutePlan = await planRoute({
        origin: "Vị trí của tôi",
        destination: marker.label,
        originCoordinate,
        destinationCoordinate,
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      rememberPlace({
        label: marker.label,
        subtitle: mapMarkerKindLabel(marker.kind),
        source: "recent",
        coordinate: destinationCoordinate,
      });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không vẽ được đường tới điểm đánh dấu");
    } finally {
      setIsUsingCurrentLocation(false);
      setIsPlanningRoute(false);
    }
  }

  /**
   * Toggles which POI categories should be shown near the route.
   */
  function handleTogglePoiKind(kind: ApiTripPoiKind) {
    setSelectedPoiKinds((current) => {
      if (current.includes(kind)) {
        return current.length === 1 ? current : current.filter((item) => item !== kind);
      }

      return [...current, kind];
    });
  }

  /**
   * Plans a route from current GPS to a selected POI.
   */
  async function handlePlanRouteToPoi(poi: ApiTripPoi) {
    if (isPlanningRoute || isUsingCurrentLocation) {
      return;
    }

    if (!("geolocation" in navigator)) {
      setApiError("Trình duyệt không lấy được vị trí GPS");
      return;
    }

    setIsUsingCurrentLocation(true);
    setIsPlanningRoute(true);
    setApiError(null);

    try {
      const position = await getCurrentBrowserPosition();
      const originCoordinate = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      const destinationCoordinate = {
        lat: poi.latitude,
        lng: poi.longitude,
      };

      setRouteOrigin("Vị trí của tôi");
      setRouteOriginCoordinate(originCoordinate);
      setRouteDestination(poi.name);
      setRouteDestinationCoordinate(destinationCoordinate);

      const nextRoutePlan = await planRoute({
        origin: "Vị trí của tôi",
        destination: poi.name,
        originCoordinate,
        destinationCoordinate,
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      rememberPlace({
        label: poi.name,
        subtitle: `${poiKindLabel(poi.kind)} · ${poi.distanceFromRouteKm.toFixed(1)} km`,
        source: "recent",
        coordinate: destinationCoordinate,
      });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không vẽ được đường tới địa điểm này");
    } finally {
      setIsUsingCurrentLocation(false);
      setIsPlanningRoute(false);
    }
  }

  /**
   * Saves a route POI as a persistent shared map marker.
   */
  async function handleSavePoiAsMarker(poi: ApiTripPoi) {
    if (isSavingMapMarker) {
      return;
    }

    setIsSavingMapMarker(true);
    setApiError(null);

    try {
      const marker = await createTripMapMarker({
        label: poi.name,
        kind: poi.kind,
        latitude: poi.latitude,
        longitude: poi.longitude,
      }, selectedTripId);
      setMapMarkers((current) => [marker, ...current.filter((item) => item.id !== marker.id)]);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không lưu được địa điểm lên map");
    } finally {
      setIsSavingMapMarker(false);
    }
  }

  /**
   * Updates the current trip lifecycle status.
   */
  async function handleUpdateTripStatus(status: ApiTripStatus) {
    if (!activeTrip || isUpdatingTripStatus) {
      return;
    }

    setIsUpdatingTripStatus(true);
    setApiError(null);

    try {
      const trip = await updateTripStatus(activeTrip.id, status);
      setTrips((current) => current.map((item) => (item.id === trip.id ? trip : item)));
      setActiveTab(status === "completed" || status === "archived" ? "recap" : "route");
      await loadTripData({ silent: true });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không đổi được trạng thái chuyến đi");
    } finally {
      setIsUpdatingTripStatus(false);
    }
  }

  /**
   * Deletes the current trip after user confirmation.
   */
  async function handleDeleteTrip() {
    if (!activeTrip || isDeletingTrip) {
      return;
    }

    const confirmed = window.confirm(`Xóa vĩnh viễn chuyến "${activeTrip.title}"? Toàn bộ chi phí, GPS, tin nhắn và điểm đánh dấu của chuyến này sẽ bị xóa.`);

    if (!confirmed) {
      return;
    }

    setIsDeletingTrip(true);
    setApiError(null);

    try {
      if (isSharingLocation) {
        await handleStopSharingLocation();
      }

      await deleteTrip(activeTrip.id);
      const remainingTrips = trips.filter((trip) => trip.id !== activeTrip.id);
      setTrips(remainingTrips);
      handleTripChange(remainingTrips[0]?.id ?? "");
      await loadTripData({ silent: true });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không xóa được chuyến đi");
    } finally {
      setIsDeletingTrip(false);
    }
  }

  /**
   * Switches the cockpit to another trip workspace.
   */
  function handleTripChange(nextTripId: string) {
    if (isSharingLocation) {
      void handleStopSharingLocation();
    }

    routeFormDirtyRef.current = false;
    setSelectedTripId(nextTripId);
    window.localStorage.setItem(selectedTripCacheKey(), nextTripId);
    setApiError(null);
    setIsUsingOfflineRoute(false);
    setExpenses([]);
    setBalances([]);
    setSettlements([]);
    setMembers([]);
    setMapMarkers([]);
    setTripPois([]);
    setMemberLocations([]);
    setPresenceUsers([]);
    setPresenceNotice(null);
    setSelectedPresenceUserId(null);
    setLocationAddresses({});
    setFocusedLocationRequest(null);
    setIsPlacingMapMarker(false);
    setPendingMapMarker(null);
    setMapMarkerLabel("");
    const cachedRoutePlan = readCachedRoutePlan(nextTripId);

    if (cachedRoutePlan) {
      applyRoutePlan(cachedRoutePlan, { cache: false, fromCache: true, tripId: nextTripId });
    } else {
      setRoutePlan(null);
      setOfflineReady(false);
    }
  }

  /**
   * Creates a new trip from the trip manager form.
   */
  async function handleCreateTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newTripTitle.trim() || isCreatingTrip) {
      return;
    }

    setIsCreatingTrip(true);
    setApiError(null);

    try {
      const trip = await createTrip({
        title: newTripTitle.trim(),
        currency: "VND",
      });
      setNewTripTitle("");
      setTrips((current) => [trip, ...current.filter((item) => item.id !== trip.id)]);
      handleTripChange(trip.id);
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không tạo được chuyến đi");
    } finally {
      setIsCreatingTrip(false);
    }
  }

  /**
   * Manually starts syncing offline queued expenses.
   */
  function handleSyncQueuedExpenses() {
    void syncQueuedExpenses();
  }

  /**
   * Manually refreshes the current trip data.
   */
  function handleRefreshTripData() {
    void loadTripData({ silent: true });
  }

  /**
   * Changes the active mobile cockpit tab.
   */
  function handleSelectTab(tab: MobileTab) {
    setActiveTab(tab);
    setIsAppRailOpen(false);
    setIsAppRailMinimized(false);
  }

  /**
   * Opens or closes the floating navigation rail.
   */
  function handleToggleAppRail() {
    if (isAppRailMinimized) {
      setIsAppRailMinimized(false);
      setIsAppRailOpen(true);
      return;
    }

    setIsAppRailOpen((current) => !current);
  }

  /**
   * Minimizes the floating navigation rail into a small handle.
   */
  function handleMinimizeAppRail() {
    setIsAppRailOpen(false);
    setIsAppRailMinimized(true);
  }

  /**
   * Moves the floating navigation rail between left and right sides.
   */
  function handleMoveAppRail() {
    setAppRailSide((current) => (current === "left" ? "right" : "left"));
  }

  /**
   * Logs the user out and stops local/live GPS sharing.
   */
  async function handleLogout() {
    await handleStopSharingLocation();
    await logout();
    clearAutoEnterApp();
    setCurrentUser(null);
    setTrips([]);
    setExpenses([]);
    setBalances([]);
    setSettlements([]);
    setMembers([]);
    setMapMarkers([]);
    setTripPois([]);
    setMemberLocations([]);
    setPresenceUsers([]);
    setPresenceNotice(null);
    setRoutePlan(null);
    setLastSyncedAt(null);
  }

  /**
   * Adds or invites a member to the current trip.
   */
  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newMemberName.trim() && !newMemberEmail.trim()) {
      return;
    }

    setApiError(null);

    try {
      await addTripMember({
        ...(newMemberName.trim() ? { displayName: newMemberName.trim() } : {}),
        ...(newMemberEmail.trim() ? { email: newMemberEmail.trim() } : {}),
        role: newMemberRole,
      }, selectedTripId);
      setNewMemberName("");
      setNewMemberEmail("");
      setNewMemberRole("viewer");
      setActiveTab("group");
      await loadTripData();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không thêm được thành viên");
    }
  }

  /**
   * Changes a member role when the current user has owner permissions.
   */
  async function handleRoleChange(memberId: string, role: ApiTripRole) {
    setApiError(null);

    try {
      await updateTripMember(memberId, { role }, selectedTripId);
      await loadTripData();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không đổi được quyền");
    }
  }

  /**
   * Removes a member from the current trip room.
   */
  async function handleRemoveMember(memberId: string) {
    setApiError(null);

    try {
      await removeTripMember(memberId, selectedTripId);
      await loadTripData();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không xóa được thành viên");
    }
  }

  /**
   * Updates one field in the current user's editable profile draft.
   */
  function updateProfileDraft<K extends keyof MemberProfileDraft>(key: K, value: MemberProfileDraft[K]) {
    setProfileDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  /**
   * Saves the current user's profile fields to the backend.
   */
  async function handleSaveMemberProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentUser || !currentMember) {
      return;
    }

    setIsSavingProfile(true);
    setApiError(null);

    try {
      const nextStatusEmoji = profileDraft.statusEmoji.trim() || travelStatusEmoji(profileDraft.travelStatus);

      await updateTripMember(currentUser.id, {
        displayName: profileDraft.displayName.trim(),
        phoneNumber: profileDraft.phoneNumber.trim() || null,
        homeBase: profileDraft.homeBase.trim() || null,
        travelStatus: profileDraft.travelStatus,
        statusEmoji: nextStatusEmoji,
        avatarColor: profileDraft.avatarColor,
        backgroundKey: profileDraft.backgroundKey,
      }, selectedTripId);
      await loadTripData();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không lưu được hồ sơ");
    } finally {
      setIsSavingProfile(false);
    }
  }

  if (!currentUser) {
    return <AuthScreen theme={theme} onAuthenticated={setCurrentUser} onThemeToggle={toggleTheme} />;
  }

  return (
    <main className="app-shell" data-active-tab={activeTab}>
      {showEntryAnimation && (
        <div className="entry-animation" role="status" aria-live="polite">
          <div className="entry-card">
            <div className="entry-compass">
              <img src="/trailledger-logo.png" alt="" />
              <Navigation size={24} />
            </div>
            <div className="entry-route" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p>TrailLedger</p>
            <strong>Đang mở chuyến đi...</strong>
          </div>

        </div>
      )}

      <div className="app-backdrop" aria-hidden="true">
        <span className="backdrop-route one" />
        <span className="backdrop-route two" />
      </div>

      <header className="top-bar">
        <div className="brand-mark logo-mark" aria-hidden="true">
          <img src="/trailledger-logo.png" alt="" />
        </div>
        <div className="brand-copy">
          <p>TrailLedger</p>
            <span>
              {currentUser.displayName} - {activeTrip?.title ?? "Chưa có chuyến"}
            </span>
        </div>
        <div className="top-actions">
          <button className="icon-button" type="button" title="Đổi giao diện" aria-label="Đổi giao diện" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button className="logout-button" type="button" onClick={handleLogout}>
            Thoát
          </button>
        </div>
      </header>

      <section className="trip-manager" aria-label="Quản lý chuyến đi">
        <label>
          <span>Chuyến đi</span>
          <select value={selectedTripId} onChange={(event) => handleTripChange(event.target.value)} disabled={!trips.length || isLoading}>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}{trip.status === "active" ? "" : ` - ${tripStatusLabel(trip.status)}`}
              </option>
            ))}
          </select>
        </label>

        <form className="trip-create-form" onSubmit={handleCreateTrip}>
          <input value={newTripTitle} onChange={(event) => setNewTripTitle(event.target.value)} placeholder="Tên chuyến mới" />
          <button type="submit" disabled={isCreatingTrip || !newTripTitle.trim()} title="Tạo chuyến" aria-label="Tạo chuyến">
            <Plus size={18} />
          </button>
        </form>
      </section>

      {activeTab === "route" && (
      <section className="trip-strip" aria-label="Thông tin chặng đi">
        <div className="route-card">
          <div>
            <span className="eyebrow">Chặng hôm nay</span>
            <h1>{routePlan && routePlan.totalDistanceKm > 0 ? `${routePlan.totalDistanceKm} km` : "0 km"}</h1>
          </div>
          <div className="route-line" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="route-meta">
            <span>{routePlan && routePlan.durationMinutes > 0 ? `${Math.round(routePlan.durationMinutes / 60)} giờ` : "Chưa có tuyến"}</span>
            <strong>{routePlan?.destination || "Tạo tuyến mới"}</strong>
          </div>
        </div>

        <div className={offlineReady ? "offline-pill ready" : "offline-pill"} aria-live="polite">
          {offlineReady ? <Check size={16} /> : <Download size={16} />}
          <span>{isUsingOfflineRoute ? "Đang dùng bản đã lưu" : offlineReady ? "Đã lưu khi mất mạng" : "Chưa lưu khi mất mạng"}</span>
        </div>
      </section>
      )}

      {activeTab === "expenses" && (
      <section className="summary-grid" aria-label="Tổng quan chi phí">
        <SummaryTile icon={<WalletCards size={18} />} label="Tổng chi" value={formatMoney(totalVnd)} />
        <SummaryTile icon={<ArrowRightLeft size={18} />} label="Cần trả" value={`${settlements.length} lượt`} />
        <SummaryTile icon={<CloudRain size={18} />} label="Thời tiết" value={`${routePlan?.summary.weatherAlerts ?? 0} cảnh báo`} />
        <SummaryTile
          icon={<RefreshCw size={18} />}
          label="Đồng bộ"
          value={syncStatusValue}
        />
      </section>
      )}

      <div className={appNavRailClass(isAppRailOpen, isAppRailMinimized, appRailSide)}>
        <button
          className="app-nav-toggle"
          type="button"
          aria-expanded={isAppRailOpen && !isAppRailMinimized}
          aria-label={isAppRailMinimized ? "Hiện thanh chức năng" : isAppRailOpen ? "Ẩn thanh chức năng" : "Hiện thanh chức năng"}
          onClick={handleToggleAppRail}
        >
          {isAppRailOpen && !isAppRailMinimized ? <X size={18} /> : <Map size={18} />}
          <span>{isAppRailOpen && !isAppRailMinimized ? "Ẩn" : navTabLabel(activeTab)}</span>
        </button>

        <nav className="mobile-tabs app-tabs" aria-label="Chuyển màn hình">
          <button className={tabButtonClass(activeTab, "route")} type="button" onClick={() => handleSelectTab("route")}>
            <Map size={17} />
            <span>Bản đồ</span>
          </button>
          <button className={tabButtonClass(activeTab, "expenses")} type="button" onClick={() => handleSelectTab("expenses")}>
            <WalletCards size={17} />
            <span>Chi phí</span>
          </button>
          <button className={tabButtonClass(activeTab, "group")} type="button" onClick={() => handleSelectTab("group")}>
            <Users size={17} />
            <span>Nhóm</span>
          </button>
          <button className={tabButtonClass(activeTab, "recap")} type="button" onClick={() => handleSelectTab("recap")}>
            <Archive size={17} />
            <span>Tổng kết</span>
          </button>
        </nav>

        <div className="app-nav-tools" aria-label="Tùy chỉnh thanh chức năng">
          <button type="button" onClick={handleMoveAppRail}>
            <ArrowRightLeft size={15} />
            <span>Đổi bên</span>
          </button>
          <button type="button" onClick={handleMinimizeAppRail}>
            <X size={15} />
            <span>Thu nhỏ</span>
          </button>
        </div>
      </div>

      {apiError && (
        <div className="api-alert" role="alert">
          {apiError}
        </div>
      )}

      <div className="live-sync-bar" role="status">
        <RefreshCw size={17} className={isRefreshingData ? "spinning" : ""} />
        <span>
          {isRefreshingData
            ? "Đang cập nhật dữ liệu nhóm..."
            : isLiveSyncConnected
              ? lastLiveSyncEvent
                ? `Đang đồng bộ: ${liveEventLabel(lastLiveSyncEvent.type)}`
                : "Đang đồng bộ"
              : lastSyncedAt
                ? `Đã đồng bộ lúc ${formatSyncTime(lastSyncedAt)}`
                : "Chưa đồng bộ dữ liệu nhóm"}
        </span>
        <button type="button" disabled={isRefreshingData || isLoading} onClick={handleRefreshTripData}>
          {isRefreshingData ? "Đang tải" : "Làm mới"}
        </button>
      </div>

      {presenceNotice && (
        <div className={`presence-toast ${presenceNotice.tone}`} role="status">
          <Users size={17} />
          <span>{presenceNotice.message}</span>
          <button type="button" aria-label="Đóng thông báo" onClick={() => setPresenceNotice(null)}>
            x
          </button>
        </div>
      )}

      {queuedExpenseCount > 0 && (
        <div className="sync-alert" role="status">
          <CloudOff size={17} />
          <span>
            {queuedExpenseCount} chi phí đang chờ đồng bộ{isSyncingExpenses ? "..." : ""}
          </span>
          <button type="button" disabled={isSyncingExpenses} onClick={handleSyncQueuedExpenses}>
            {isSyncingExpenses ? "Đang đồng bộ" : "Đồng bộ"}
          </button>
        </div>
      )}

      {activeTab === "recap" && activeTrip && trips.length > 0 && (
        <TripLifecyclePanel
          canManage={canManageTripMembers}
          expenses={expenses}
          isDeleting={isDeletingTrip}
          isUpdating={isUpdatingTripStatus}
          onDelete={handleDeleteTrip}
          onStatusChange={handleUpdateTripStatus}
          routePlan={routePlan}
          trip={activeTrip}
        />
      )}

      {activeTab === "recap" && activeTrip && trips.length > 0 && (
        <TripRecapPanel
          balances={balances}
          expenses={expenses}
          mapMarkers={mapMarkers}
          members={members}
          pois={tripPois}
          routePlan={routePlan}
          settlements={settlements}
          trip={activeTrip}
        />
      )}

      {!trips.length && !isLoading && (
        <section className="empty-state" aria-label="Bắt đầu chuyến đi">
          <Map size={24} />
          <div>
            <h2>Chưa có chuyến đi</h2>
            <p>Tạo chuyến đầu tiên, sau đó thêm thành viên, vẽ tuyến và ghi chi phí của bạn.</p>
          </div>
        </section>
      )}

      {activeTab === "route" && routePlan && trips.length > 0 && (
        <RouteIntelligence
          destination={routeDestination}
          currentUserId={currentUser.id}
          isPlanningRoute={isPlanningRoute}
          isPlacingMapMarker={isPlacingMapMarker}
          isSavingMapMarker={isSavingMapMarker}
          isSavingMemberRoute={isSavingMemberRoute}
          isSharingLocation={isSharingLocation}
          isUsingCurrentLocation={isUsingCurrentLocation}
          focusedLocationRequest={focusedLocationRequest}
          locationShareStatus={locationShareStatus}
          mapMarkerKind={mapMarkerKind}
          mapMarkerLabel={mapMarkerLabel}
          mapMarkers={mapMarkers}
          memberRoutes={memberRoutes}
          placeSuggestions={placeSuggestions}
          visibleMemberRouteSet={visibleMemberRouteSet}
          memberLocations={memberLocations}
          pois={tripPois}
          poiKinds={selectedPoiKinds}
          isLoadingPois={isLoadingPois}
          onCreateMapMarker={handleCreateMapMarker}
          onDeleteMemberRoute={handleDeleteMemberRoute}
          onDeleteMapMarker={handleDeleteMapMarker}
          onDestinationChange={handleRouteDestinationChange}
          onMapMarkerKindChange={setMapMarkerKind}
          onMapMarkerLabelChange={setMapMarkerLabel}
          onMapMarkerPointSelected={handleMapMarkerPointSelected}
          onOriginPlaceSelect={handleOriginPlaceSelect}
          onOriginChange={handleRouteOriginChange}
          onDestinationPlaceSelect={handleDestinationPlaceSelect}
          onPlanRouteToPoi={handlePlanRouteToPoi}
          onPlanRoute={handlePlanRoute}
          onPlanRouteFromCurrentLocation={handlePlanRouteFromCurrentLocation}
          onSaveOwnerRoute={handleSaveOwnerRoute}
          onToggleMemberRoute={handleToggleMemberRoute}
          onPlanRouteToMapMarker={handlePlanRouteToMapMarker}
          onPlanRouteToMember={handlePlanRouteToMember}
          onSavePoiAsMarker={handleSavePoiAsMarker}
          onStartSharingLocation={handleStartSharingLocation}
          onStopSharingLocation={handleStopSharingLocation}
          onTogglePoiKind={handleTogglePoiKind}
          onToggleMapMarkerPlacement={handleToggleMapMarkerPlacement}
          origin={routeOrigin}
          originCoordinate={routeOriginCoordinate}
          pendingMapMarker={pendingMapMarker}
          routePlan={routePlan}
          deletingMapMarkerId={deletingMapMarkerId}
          deletingMemberRouteId={deletingMemberRouteId}
          canCreateMemberRoute={canCreateMemberRoute}
          canManageMemberRoutes={canManageMemberRoutes}
        />
      )}

      {trips.length > 0 && (
        <>
          <section className="workspace">
            <form className="expense-panel" onSubmit={handleSubmit}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Khoản mới</span>
              <h2>Ghi chi phí</h2>
            </div>
            <button className="primary-icon" type="submit" title="Lưu chi phí" aria-label="Lưu chi phí" disabled={isSaving || !activeMembers.length}>
              <Plus size={20} />
            </button>
          </div>

          <label className="field">
            <span>Tên khoản</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: xăng, ăn trưa, khách sạn" />
          </label>

          <div className="amount-row">
            <label className="field amount-field">
              <span>Số tiền</span>
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
            </label>
          </div>

          <div className="select-row">
            <label className="field">
              <span>Người trả</span>
              <select value={payerId} onChange={(event) => setPayerId(event.target.value)}>
                {activeMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="member-grid" aria-label="Người tham gia">
            {activeMembers.map((member) => {
              const active = participantIds.includes(member.id);

              return (
                <button
                  key={member.id}
                  className={active ? "member-chip active" : "member-chip"}
                  type="button"
                  onClick={() => toggleParticipant(member.id)}
                >
                  <span>{member.initials}</span>
                  {member.name}
                </button>
              );
            })}
          </div>

          <button className="advanced-toggle" type="button" aria-expanded={showExpenseAdvanced} onClick={() => setShowExpenseAdvanced((current) => !current)}>
            {showExpenseAdvanced ? "Ẩn tùy chỉnh" : "Tùy chỉnh thêm"}
          </button>

          {showExpenseAdvanced && (
            <div className="expense-advanced">
              <div className="currency-switch" aria-label="Tiền tệ">
                {(["VND", "USD", "CNY"] satisfies CurrencyCode[]).map((code) => (
                  <button
                    key={code}
                    className={currency === code ? "active" : ""}
                    type="button"
                    onClick={() => setCurrency(code)}
                    title={code}
                  >
                    {code}
                  </button>
                ))}
              </div>

              <div className="category-row" aria-label="Danh mục">
                {categories.map((item) => {
                  const Icon = item.icon;

                  return (
                    <button
                      key={item.id}
                      className={category === item.id ? "category-chip active" : "category-chip"}
                      type="button"
                      onClick={() => setCategory(item.id)}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mode-switch" aria-label="Kiểu chia">
                {(["equal", "percent", "share"] satisfies SplitMode[]).map((mode) => (
                  <button key={mode} className={splitMode === mode ? "active" : ""} type="button" onClick={() => setSplitMode(mode)}>
                    {modeLabel(mode)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {splitMode !== "equal" && (
            <div className="split-grid" aria-label="Giá trị chia">
              {participantIds.map((memberId) => {
                const member = findMember(members, memberId);

                return (
                  <label className="mini-field" key={memberId}>
                    <span>{member.name}</span>
                    <input
                      inputMode="decimal"
                      value={splitValues[memberId] ?? ""}
                      placeholder={splitMode === "percent" ? "%" : "phần"}
                      onChange={(event) => updateSplitValue(memberId, event.target.value)}
                    />
                  </label>
                );
              })}
            </div>
          )}

          <div className="rate-note">
            <Calculator size={16} />
            <span>1 USD = {formatMoney(currencyRatesToVnd.USD)}, 1 CNY = {formatMoney(currencyRatesToVnd.CNY)}</span>
          </div>
        </form>

        <div className="expense-side-stack">
          <SettlementPanel balances={balances} members={members} settlements={settlements} />
        </div>

        <div className="group-stack">
          {currentMember && (
            <MemberProfilePanel
              draft={profileDraft}
              isSaving={isSavingProfile}
              member={currentMember}
              onDraftChange={updateProfileDraft}
              onSave={handleSaveMemberProfile}
            />
          )}

          <PresencePanel
            currentUserId={currentUser.id}
            isPlanningRoute={isPlanningRoute}
            isResolvingAddressFor={isResolvingAddressFor}
            isUsingCurrentLocation={isUsingCurrentLocation}
            locationAddresses={locationAddresses}
            memberLocations={memberLocations}
            members={members}
            onFocusLocation={handleFocusMemberLocation}
            onPlanRouteToMember={handlePlanRouteToMember}
            onResolveAddress={handleResolveMemberAddress}
            onSelectUser={handleSelectPresenceUser}
            presenceUsers={presenceUsers}
            selectedUserId={selectedPresenceUserId}
          />

          <MemberManagerPanel
            canManageTripMembers={canManageTripMembers}
            currentTripRole={currentTripRole}
            currentUserId={currentUser.id}
            members={members}
            newMemberEmail={newMemberEmail}
            newMemberName={newMemberName}
            newMemberRole={newMemberRole}
            onAddMember={handleAddMember}
            onMemberEmailChange={setNewMemberEmail}
            onMemberNameChange={setNewMemberName}
            onMemberRoleChange={setNewMemberRole}
            onRemoveMember={handleRemoveMember}
            onRoleChange={handleRoleChange}
          />
        </div>
          </section>

          <section className="expense-list" aria-label="Chi phí gần đây">
            <div className="section-heading">
              <h2>Chi phí gần đây</h2>
              <span>{expenses.length} khoản</span>
            </div>
            {expenses.map((expense) => (
              <article className="expense-item" key={expense.id}>
                <div className="expense-icon">{categoryIcon(expense.category)}</div>
                <div>
                  <h3>{expense.title}</h3>
                  <p>
                    {expense.createdAt} - {findMember(members, expense.paidByUserId).name} trả - {participantCount(expense)} người
                  </p>
                </div>
                <strong>{formatMoney(Number(expense.money.amount), expense.money.currency)}</strong>
              </article>
            ))}
          </section>
        </>
      )}

      {trips.length > 0 && (
        <ChatDock
          currentUserId={currentUser.id}
          draft={chatDraft}
          error={chatError}
          isOpen={isChatOpen}
          isSending={isSendingMessage}
          messageListRef={chatMessageListRef}
          messages={chatMessages}
          onDraftChange={setChatDraft}
          onSend={handleSendChatMessage}
          onToggle={handleToggleChat}
          unreadCount={unreadChatCount}
        />
      )}
    </main>
  );
}

/**
 * Shows the current trip status and owner-only lifecycle actions such as finish,
 * archive, reopen, or delete. Keeping this separate from the main planner makes
 * it easier to reason about destructive trip actions.
 */
function TripLifecyclePanel({
  canManage,
  expenses,
  isDeleting,
  isUpdating,
  onDelete,
  onStatusChange,
  routePlan,
  trip,
}: {
  canManage: boolean;
  expenses: ApiExpense[];
  isDeleting: boolean;
  isUpdating: boolean;
  onDelete: () => void;
  onStatusChange: (status: ApiTripStatus) => void;
  routePlan: ApiRoutePlan | null;
  trip: ApiTrip;
}) {
  const total = expenses.reduce((sum, expense) => sum + toVnd(Number(expense.money.amount), expense.money.currency), 0);

  return (
    <section className={`trip-lifecycle ${trip.status}`} aria-label="Trạng thái chuyến đi">
      <div>
        <span className="eyebrow">Vòng đời chuyến đi</span>
        <h2>{tripStatusLabel(trip.status)}</h2>
        <p>
          {routePlan?.totalDistanceKm ?? 0} km · {expenses.length} khoản · {formatMoney(total)}
        </p>
      </div>

      <div className="trip-lifecycle-actions">
        {trip.status === "active" && (
          <button type="button" disabled={!canManage || isUpdating} onClick={() => onStatusChange("completed")}>
            <Check size={16} />
            <span>{isUpdating ? "Đang kết thúc" : "Kết thúc"}</span>
          </button>
        )}
        {trip.status === "completed" && (
          <>
            <button type="button" disabled={!canManage || isUpdating} onClick={() => onStatusChange("archived")}>
              <Archive size={16} />
              <span>Lưu trữ</span>
            </button>
            <button type="button" disabled={!canManage || isUpdating} onClick={() => onStatusChange("active")}>
              <RotateCcw size={16} />
              <span>Mở lại</span>
            </button>
          </>
        )}
        {trip.status === "archived" && (
          <button type="button" disabled={!canManage || isUpdating} onClick={() => onStatusChange("active")}>
            <RotateCcw size={16} />
            <span>Mở lại</span>
          </button>
        )}
        {trip.status !== "active" && (
          <button className="danger-action" type="button" disabled={!canManage || isDeleting} onClick={onDelete}>
            <Trash2 size={16} />
            <span>{isDeleting ? "Đang xóa" : "Xóa chuyến"}</span>
          </button>
        )}
      </div>

      {!canManage && <p className="trip-lifecycle-note">Chỉ chủ phòng mới được kết thúc, lưu trữ hoặc xóa chuyến.</p>}
    </section>
  );
}

/**
 * Builds the post-trip summary view from already-loaded route, expense, member,
 * marker, and POI data. It is intentionally read-only so recap UI cannot mutate
 * trip state by accident.
 */
function TripRecapPanel({
  balances,
  expenses,
  mapMarkers,
  members,
  pois,
  routePlan,
  settlements,
  trip,
}: {
  balances: ApiBalance[];
  expenses: ApiExpense[];
  mapMarkers: ApiMapMarker[];
  members: TripMemberView[];
  pois: ApiTripPoi[];
  routePlan: ApiRoutePlan | null;
  settlements: ApiSettlement[];
  trip: ApiTrip;
}) {
  const total = expenses.reduce((sum, expense) => sum + toVnd(Number(expense.money.amount), expense.money.currency), 0);
  const topCategories = summarizeExpensesByCategory(expenses).slice(0, 4);
  const markerSummary = summarizeMapMarkers(mapMarkers);
  const weatherAlerts = routePlan?.waypoints.filter((waypoint) => waypoint.weather.riskLevel !== "low") ?? [];

  return (
    <section className="trip-recap-panel" aria-label="Tổng kết chuyến đi">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Tổng kết sau chuyến</span>
          <h2>{trip.title}</h2>
          <p>{trip.completedAt ? `Kết thúc lúc ${formatDateTime(trip.completedAt)}` : "Bản tổng kết sẽ đầy đủ hơn khi bạn bấm Kết thúc."}</p>
        </div>
        <Archive size={22} />
      </div>

      <div className="recap-grid">
        <MiniMetric label="Tổng đường" value={`${routePlan?.totalDistanceKm ?? 0} km`} />
        <MiniMetric label="Thời gian chạy" value={formatDuration(routePlan?.durationMinutes ?? 0)} />
        <MiniMetric label="Tổng chi" value={formatMoney(total)} />
        <MiniMetric label="Thành viên đang đi" value={`${members.filter((member) => member.active).length}`} />
      </div>

      <div className="recap-columns">
        <div className="recap-card">
          <h3>Chi phí theo nhóm</h3>
          {topCategories.length ? (
            topCategories.map((item) => (
              <div className="recap-line" key={item.category}>
                <span>{expenseCategoryLabel(item.category)}</span>
                <strong>{formatMoney(item.total)}</strong>
              </div>
            ))
          ) : (
            <p>Chưa có chi phí.</p>
          )}
        </div>

        <div className="recap-card">
          <h3>Ai trả ai</h3>
          {settlements.length ? (
            settlements.map((settlement, index) => (
              <div className="recap-line" key={`${settlement.fromUserId}-${settlement.toUserId}-${index}`}>
                <span>
                  {findMember(members, settlement.fromUserId).name} → {findMember(members, settlement.toUserId).name}
                </span>
                <strong>{formatMoney(Number(settlement.amountMinor), settlement.currency)}</strong>
              </div>
            ))
          ) : balances.length ? (
            <p>Không còn khoản cần chuyển.</p>
          ) : (
            <p>Chưa có dữ liệu chia tiền.</p>
          )}
        </div>

        <div className="recap-card">
          <h3>Địa điểm đã lưu</h3>
          {markerSummary.length ? (
            markerSummary.map((item) => (
              <div className="recap-line" key={item.kind}>
                <span>{mapMarkerKindLabel(item.kind)}</span>
                <strong>{item.count}</strong>
              </div>
            ))
          ) : (
            <p>Chưa lưu điểm nào trên map.</p>
          )}
        </div>

        <div className="recap-card">
          <h3>Thời tiết & tiện ích</h3>
          <div className="recap-line">
            <span>Cảnh báo thời tiết</span>
            <strong>{weatherAlerts.length}</strong>
          </div>
          <div className="recap-line">
            <span>Quán ăn/chỗ nghỉ/cây xăng gần tuyến</span>
            <strong>{pois.length}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Renders the floating group chat bubble and compact message window. Chat stays
 * decoupled from the main panels so riders can keep the map visible while
 * coordinating quick messages.
 */
function ChatDock({
  currentUserId,
  draft,
  error,
  isOpen,
  isSending,
  messageListRef,
  messages,
  onDraftChange,
  onSend,
  onToggle,
  unreadCount,
}: {
  currentUserId: string;
  draft: string;
  error: string | null;
  isOpen: boolean;
  isSending: boolean;
  messageListRef: RefObject<HTMLDivElement | null>;
  messages: ApiTripMessage[];
  onDraftChange(value: string): void;
  onSend(event: FormEvent<HTMLFormElement>): void;
  onToggle(): void;
  unreadCount: number;
}) {
  return (
    <aside className={isOpen ? "chat-dock open" : "chat-dock"} aria-label="Tin nhắn nhóm">
      {isOpen && (
        <section className="chat-panel">
          <header className="chat-panel-head">
            <div>
              <span className="eyebrow">Tin nhắn</span>
              <h2>Chat nhóm</h2>
            </div>
            <button type="button" title="Thu gọn chat" aria-label="Thu gọn chat" onClick={onToggle}>
              <X size={18} />
            </button>
          </header>

          <div className="chat-messages" ref={messageListRef}>
            {messages.length ? (
              messages.map((message) => {
                const isSelf = message.userId === currentUserId;

                return (
                  <article className={isSelf ? "chat-message self" : "chat-message"} key={message.id}>
                    <div>
                      <strong>{isSelf ? "Bạn" : message.displayName}</strong>
                      <span>{formatChatTime(message.createdAt)}</span>
                    </div>
                    <p>{message.body}</p>
                  </article>
                );
              })
            ) : (
              <div className="chat-empty">
                <MessageCircle size={22} />
                <p>Chưa có tin nhắn. Gửi lời chào để mọi người biết bạn đang theo dõi phòng.</p>
              </div>
            )}
          </div>

          {error && <p className="chat-error">{error}</p>}

          <form className="chat-compose" onSubmit={onSend}>
            <input value={draft} onChange={(event) => onDraftChange(event.target.value)} maxLength={1000} placeholder="Nhập tin nhắn..." />
            <button type="submit" disabled={isSending || !draft.trim()} title="Gửi tin nhắn" aria-label="Gửi tin nhắn">
              <Send size={18} />
            </button>
          </form>
        </section>
      )}

      <button className="chat-bubble" type="button" title={isOpen ? "Thu gọn chat" : "Mở chat nhóm"} aria-label={isOpen ? "Thu gọn chat" : "Mở chat nhóm"} onClick={onToggle}>
        <MessageCircle size={22} />
        {unreadCount > 0 && <span>{Math.min(unreadCount, 9)}</span>}
      </button>
    </aside>
  );
}

/**
 * Lets the current user edit the lightweight profile shown inside a trip room.
 * Only simple, trip-specific fields live here so account identity and Firebase
 * authentication remain separated from social/profile presentation.
 */
function MemberProfilePanel({
  draft,
  isSaving,
  member,
  onDraftChange,
  onSave,
}: {
  draft: MemberProfileDraft;
  isSaving: boolean;
  member: TripMemberView;
  onDraftChange: <K extends keyof MemberProfileDraft>(key: K, value: MemberProfileDraft[K]) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const phoneHref = safeTelHref(member.phoneNumber);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <section className={`member-profile-panel profile-bg-${draft.backgroundKey}`} aria-label="Hồ sơ của tôi">
      <div className="member-profile-head">
        <Avatar member={member} />
        <div>
          <span className="eyebrow">Hồ sơ trong phòng</span>
          <h2>{member.name}</h2>
          <p>
            {member.statusEmoji || travelStatusEmoji(member.travelStatus)} {travelStatusLabel(member.travelStatus)}
            {member.homeBase ? ` · ${member.homeBase}` : ""}
          </p>
        </div>
        {phoneHref && (
          <a className="profile-call-button" href={phoneHref} aria-label="Gọi nhanh">
            <Phone size={18} />
          </a>
        )}
      </div>

      <form className="member-profile-form" onSubmit={onSave}>
        <label className="field">
          <span>Tên hiển thị</span>
          <input value={draft.displayName} maxLength={80} onChange={(event) => onDraftChange("displayName", event.target.value)} />
        </label>

        <div className="profile-inline-grid">
          <label className="field">
            <span>Số điện thoại</span>
            <input value={draft.phoneNumber} inputMode="tel" maxLength={24} placeholder="Ví dụ: 090..." onChange={(event) => onDraftChange("phoneNumber", event.target.value)} />
          </label>

          <label className="field">
            <span>Trạng thái</span>
            <select
              value={draft.travelStatus}
              onChange={(event) => {
                const nextStatus = event.target.value as ApiTripMemberTravelStatus;
                onDraftChange("travelStatus", nextStatus);
                onDraftChange("statusEmoji", travelStatusEmoji(nextStatus));
              }}
            >
              {travelStatusOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.emoji} {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button className="advanced-toggle compact" type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((current) => !current)}>
          {showAdvanced ? "Ẩn chỉnh thêm" : "Chỉnh thêm"}
        </button>

        {showAdvanced && (
          <div className="profile-advanced">
            <div className="profile-inline-grid">
              <label className="field">
                <span>Nơi ở</span>
                <input value={draft.homeBase} maxLength={80} placeholder="Ví dụ: Sóc Trăng" onChange={(event) => onDraftChange("homeBase", event.target.value)} />
              </label>

              <label className="field">
                <span>Emoji</span>
                <input value={draft.statusEmoji} maxLength={4} onChange={(event) => onDraftChange("statusEmoji", event.target.value)} />
              </label>
            </div>

            <div className="profile-picker-row" aria-label="Màu đại diện">
              {avatarColorOptions.map((color) => (
                <button
                  key={color}
                  className={draft.avatarColor === color ? `profile-swatch ${color} active` : `profile-swatch ${color}`}
                  type="button"
                  title={`Màu ${color}`}
                  aria-label={`Chọn màu ${color}`}
                  onClick={() => onDraftChange("avatarColor", color)}
                />
              ))}
            </div>

            <label className="field">
              <span>Hình nền thẻ</span>
              <select value={draft.backgroundKey} onChange={(event) => onDraftChange("backgroundKey", event.target.value as ApiTripMemberBackgroundKey)}>
                {backgroundOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <button className="profile-save-button" type="submit" disabled={isSaving || !draft.displayName.trim()}>
          <Smile size={17} />
          <span>{isSaving ? "Đang lưu..." : "Lưu hồ sơ"}</span>
        </button>
      </form>
    </section>
  );
}

/**
 * Lists who is currently online in the trip and exposes quick rider actions:
 * focus on map, route to that member, resolve address, or call when a phone
 * number is available.
 */
function PresencePanel({
  currentUserId,
  isPlanningRoute,
  isResolvingAddressFor,
  isUsingCurrentLocation,
  locationAddresses,
  memberLocations,
  members,
  onFocusLocation,
  onPlanRouteToMember,
  onResolveAddress,
  onSelectUser,
  presenceUsers,
  selectedUserId,
}: {
  currentUserId: string;
  isPlanningRoute: boolean;
  isResolvingAddressFor: string | null;
  isUsingCurrentLocation: boolean;
  locationAddresses: Record<string, ApiMemberLocationAddress>;
  memberLocations: ApiMemberLocation[];
  members: TripMemberView[];
  onFocusLocation: (location: ApiMemberLocation) => void;
  onPlanRouteToMember: (location: ApiMemberLocation) => void;
  onResolveAddress: (location: ApiMemberLocation) => void;
  onSelectUser: (userId: string) => void;
  presenceUsers: ApiPresenceUser[];
  selectedUserId: string | null;
}) {
  return (
    <section className="presence-panel" aria-label="Nhóm đang đi">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Nhóm đang đi</span>
          <h2>{presenceUsers.length} người online</h2>
        </div>
        <Users size={22} />
      </div>

      <div className="presence-list">
        {presenceUsers.length ? (
          presenceUsers.map((user) => {
            const member = members.find((item) => item.id === user.userId);
            const location = memberLocations.find((item) => item.userId === user.userId);
            const address = locationAddresses[user.userId];
            const isSelected = selectedUserId === user.userId;
            const canRouteToMember = Boolean(location && user.userId !== currentUserId && !isPlanningRoute && !isUsingCurrentLocation);
            const phoneHref = safeTelHref(member?.phoneNumber ?? null);
            const status = member?.travelStatus ?? "riding";
            const statusEmoji = member?.statusEmoji || travelStatusEmoji(status);

            return (
              <article className={isSelected ? "presence-item selected" : "presence-item"} key={user.userId}>
                <button
                  className={user.userId === currentUserId ? "presence-row self" : "presence-row"}
                  type="button"
                  onClick={() => onSelectUser(user.userId)}
                >
                  <Avatar member={member ?? { id: user.userId, name: user.displayName, initials: createInitials(user.displayName) }} />
                  <div>
                    <strong>{user.userId === currentUserId ? "Bạn" : user.displayName}</strong>
                    <span>
                      {statusEmoji} {travelStatusLabel(status)} · Online từ {formatLocationTime(user.onlineSince)}
                      {user.connectionCount > 1 ? ` - ${user.connectionCount} thiết bị` : ""}
                    </span>
                  </div>
                  <i aria-label="Đang online" />
                </button>

                {isSelected && (
                  <div className="presence-actions">
                    {location ? (
                      <>
                        <div className="presence-action-buttons">
                          <button type="button" onClick={() => onFocusLocation(location)}>
                            <MapPin size={15} />
                            <span>Định vị</span>
                          </button>
                          <button type="button" disabled={!canRouteToMember} onClick={() => onPlanRouteToMember(location)}>
                            <Navigation size={15} />
                            <span>Đi gặp</span>
                          </button>
                          <button type="button" disabled={isResolvingAddressFor === user.userId} onClick={() => onResolveAddress(location)}>
                            <MapPin size={15} />
                            <span>{isResolvingAddressFor === user.userId ? "Đang lấy..." : "Lấy địa chỉ"}</span>
                          </button>
                          {phoneHref && (
                            <a href={phoneHref}>
                              <Phone size={15} />
                              <span>Gọi</span>
                            </a>
                          )}
                        </div>
                        <p>
                          {member?.homeBase ? `${member.homeBase} · ` : ""}
                          {address ? address.address : `GPS cập nhật ${formatLocationTime(location.sharedAt)}`}
                        </p>
                      </>
                    ) : (
                      <>
                        {phoneHref && (
                          <div className="presence-action-buttons single">
                            <a href={phoneHref}>
                              <Phone size={15} />
                              <span>Gọi</span>
                            </a>
                          </div>
                        )}
                        <p>
                          {member?.homeBase ? `${member.homeBase} · ` : ""}
                          Người này đang online nhưng chưa bật chia sẻ GPS.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })
        ) : (
          <p>Chưa thấy ai trong phòng. Khi có người mở chuyến đi, danh sách sẽ tự hiện.</p>
        )}
      </div>
    </section>
  );
}

/**
 * Presents the split-bill result in human language: who should pay whom and
 * each member's net balance. The calculation itself stays in the backend; this
 * component only formats the returned settlement model.
 */
function SettlementPanel({
  balances,
  members,
  settlements,
}: {
  balances: ApiBalance[];
  members: TripMemberView[];
  settlements: ApiSettlement[];
}) {
  return (
    <section className="settlement-panel" aria-label="Thanh toán đề xuất">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Công nợ nhóm</span>
          <h2>Ai trả ai</h2>
        </div>
        <ArrowRightLeft size={22} />
      </div>

      <div className="settlement-list">
        {settlements.length ? (
          settlements.map((settlement) => (
            <div className="settlement-item" key={`${settlement.fromUserId}-${settlement.toUserId}-${settlement.amountMinor}`}>
              <Avatar member={findMember(members, settlement.fromUserId)} />
              <div className="settlement-copy">
                <strong>
                  {findMember(members, settlement.fromUserId).name} trả {findMember(members, settlement.toUserId).name}
                </strong>
                <span>{formatMoney(Number(settlement.amountMinor), settlement.currency)}</span>
              </div>
              <ArrowRightLeft size={18} />
            </div>
          ))
        ) : (
          <p className="empty-panel-note">Chưa có khoản cần thanh toán.</p>
        )}
      </div>

      <div className="balance-list">
        {balances.map((balance) => {
          const amount = Number(balance.balanceMinor);

          return (
            <div className="balance-row" key={balance.userId}>
              <span>{findMember(members, balance.userId).name}</span>
              <strong className={amount > 0 ? "positive" : "negative"}>{formatMoney(amount, balance.currency)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Owner/editor-facing member management panel. It renders add, role-change,
 * and soft-remove controls while respecting the permission flags computed by
 * the authenticated trip membership state.
 */
function MemberManagerPanel({
  canManageTripMembers,
  currentTripRole,
  currentUserId,
  members,
  newMemberEmail,
  newMemberName,
  newMemberRole,
  onAddMember,
  onMemberEmailChange,
  onMemberNameChange,
  onMemberRoleChange,
  onRemoveMember,
  onRoleChange,
}: {
  canManageTripMembers: boolean;
  currentTripRole: ApiTripRole;
  currentUserId: string;
  members: TripMemberView[];
  newMemberEmail: string;
  newMemberName: string;
  newMemberRole: ApiTripRole;
  onAddMember: (event: FormEvent<HTMLFormElement>) => void;
  onMemberEmailChange: (value: string) => void;
  onMemberNameChange: (value: string) => void;
  onMemberRoleChange: (value: ApiTripRole) => void;
  onRemoveMember: (memberId: string) => void;
  onRoleChange: (memberId: string, role: ApiTripRole) => void;
}) {
  const activeMembers = members.filter((member) => member.active);
  const removedMembers = members.filter((member) => !member.active);

  return (
    <section className="member-manager-panel" aria-label="Quản lý thành viên">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Quản lý nhóm</span>
          <h2>Thành viên</h2>
        </div>
        <span className="role-pill">{roleLabel(currentTripRole)}</span>
      </div>

      <form className="member-add-form" onSubmit={onAddMember}>
        <input
          value={newMemberEmail}
          onChange={(event) => onMemberEmailChange(event.target.value)}
          placeholder="Email đăng nhập"
          disabled={!canManageTripMembers}
        />
        <input
          value={newMemberName}
          onChange={(event) => onMemberNameChange(event.target.value)}
          placeholder="Tên hiển thị"
          disabled={!canManageTripMembers}
        />
        <select value={newMemberRole} onChange={(event) => onMemberRoleChange(event.target.value as ApiTripRole)} disabled={!canManageTripMembers}>
          <option value="viewer">{roleLabel("viewer")}</option>
          <option value="editor">{roleLabel("editor")}</option>
          <option value="owner">{roleLabel("owner")}</option>
        </select>
        <button type="submit" disabled={!canManageTripMembers} title="Thêm thành viên" aria-label="Thêm thành viên">
          <Plus size={18} />
        </button>
      </form>

      <div className="trip-member-list">
        {activeMembers.map((member) => (
          <div className="trip-member-row" key={member.id}>
            <Avatar member={member} />
            <span>{member.name}</span>
            <select
              value={member.role}
              onChange={(event) => onRoleChange(member.id, event.target.value as ApiTripRole)}
              disabled={!canManageTripMembers || member.id === currentUserId}
            >
              <option value="viewer">{roleLabel("viewer")}</option>
              <option value="editor">{roleLabel("editor")}</option>
              <option value="owner">{roleLabel("owner")}</option>
            </select>
            <button
              type="button"
              title="Xóa thành viên"
              aria-label="Xóa thành viên"
              disabled={!canManageTripMembers || member.id === currentUserId}
              onClick={() => onRemoveMember(member.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {removedMembers.length > 0 && (
        <div className="former-member-list">
          <span className="eyebrow">Đã xóa khỏi phòng</span>
          {removedMembers.map((member) => (
            <div className="former-member-row" key={member.id}>
              <Avatar member={member} />
              <span>{member.name}</span>
              <small>{member.removedAt ? formatDateTime(member.removedAt) : "Đã rời phòng"}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Shows locally saved/recent place suggestions below route inputs. Suggestions
 * are intentionally local-first so riders can quickly reuse places even before
 * external search providers return results.
 */
function PlaceSuggestionList({ suggestions, onSelect }: { suggestions: SavedPlace[]; onSelect: (place: SavedPlace) => void }) {
  if (!suggestions.length) {
    return null;
  }

  return (
    <div className="place-suggestion-list">
      {suggestions.map((place) => (
        <button key={place.id} type="button" onClick={() => onSelect(place)}>
          <MapPin size={15} />
          <span>
            <strong>{place.label}</strong>
            <small>{place.subtitle || placeSourceLabel(place.source)}</small>
          </span>
          <em>{placeSourceLabel(place.source)}</em>
        </button>
      ))}
    </div>
  );
}

/**
 * Map-first cockpit for planning, riding, POI filters, saved markers, and member
 * routes. This component owns only the UI state for fullscreen/ride mode and the
 * mobile bottom sheet; data mutations are passed in through callbacks.
 */
function RouteIntelligence({
  canManageMemberRoutes,
  canCreateMemberRoute,
  currentUserId,
  deletingMapMarkerId,
  deletingMemberRouteId,
  destination,
  focusedLocationRequest,
  isPlanningRoute,
  isPlacingMapMarker,
  isSavingMapMarker,
  isSavingMemberRoute,
  isSharingLocation,
  isUsingCurrentLocation,
  locationShareStatus,
  mapMarkerKind,
  mapMarkerLabel,
  mapMarkers,
  memberRoutes,
  placeSuggestions,
  visibleMemberRouteSet,
  memberLocations,
  pois,
  poiKinds,
  isLoadingPois,
  onCreateMapMarker,
  onDeleteMemberRoute,
  onDeleteMapMarker,
  onDestinationChange,
  onMapMarkerKindChange,
  onMapMarkerLabelChange,
  onMapMarkerPointSelected,
  onOriginPlaceSelect,
  onOriginChange,
  onDestinationPlaceSelect,
  onPlanRouteToPoi,
  onPlanRoute,
  onPlanRouteFromCurrentLocation,
  onSaveOwnerRoute,
  onToggleMemberRoute,
  onPlanRouteToMapMarker,
  onPlanRouteToMember,
  onSavePoiAsMarker,
  onStartSharingLocation,
  onStopSharingLocation,
  onTogglePoiKind,
  onToggleMapMarkerPlacement,
  origin,
  originCoordinate,
  pendingMapMarker,
  routePlan,
}: {
  canManageMemberRoutes: boolean;
  canCreateMemberRoute: boolean;
  currentUserId: string;
  deletingMapMarkerId: string | null;
  deletingMemberRouteId: string | null;
  destination: string;
  focusedLocationRequest: FocusedLocationRequest | null;
  isPlanningRoute: boolean;
  isPlacingMapMarker: boolean;
  isSavingMapMarker: boolean;
  isSavingMemberRoute: boolean;
  isSharingLocation: boolean;
  isUsingCurrentLocation: boolean;
  locationShareStatus: LocationShareStatus;
  mapMarkerKind: ApiMapMarkerKind;
  mapMarkerLabel: string;
  mapMarkers: ApiMapMarker[];
  memberRoutes: ApiMemberRoute[];
  placeSuggestions: SavedPlace[];
  visibleMemberRouteSet: Set<string>;
  memberLocations: ApiMemberLocation[];
  pois: ApiTripPoi[];
  poiKinds: ApiTripPoiKind[];
  isLoadingPois: boolean;
  onCreateMapMarker: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteMemberRoute: (route: ApiMemberRoute) => void;
  onDeleteMapMarker: (marker: ApiMapMarker) => void;
  onDestinationChange: (value: string) => void;
  onMapMarkerKindChange: (kind: ApiMapMarkerKind) => void;
  onMapMarkerLabelChange: (value: string) => void;
  onMapMarkerPointSelected: (point: ApiGeoPoint) => void;
  onOriginPlaceSelect: (place: SavedPlace) => void;
  onOriginChange: (value: string) => void;
  onDestinationPlaceSelect: (place: SavedPlace) => void;
  onPlanRouteToPoi: (poi: ApiTripPoi) => void;
  onPlanRoute: (event: FormEvent<HTMLFormElement>) => void;
  onPlanRouteFromCurrentLocation: () => void;
  onSaveOwnerRoute: () => void;
  onToggleMemberRoute: (routeId: string) => void;
  onPlanRouteToMapMarker: (marker: ApiMapMarker) => void;
  onPlanRouteToMember: (location: ApiMemberLocation) => void;
  onSavePoiAsMarker: (poi: ApiTripPoi) => void;
  onStartSharingLocation: () => void;
  onStopSharingLocation: () => void;
  onTogglePoiKind: (kind: ApiTripPoiKind) => void;
  onToggleMapMarkerPlacement: () => void;
  origin: string;
  originCoordinate: ApiGeoPoint | null;
  pendingMapMarker: ApiGeoPoint | null;
  routePlan: ApiRoutePlan;
}) {
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [isRideMode, setIsRideMode] = useState(false);
  const [sheetState, setSheetState] = useState<"collapsed" | "half" | "expanded">("collapsed");
  const touchStartY = useRef<number>(0);
  const didSheetSwipe = useRef(false);

  /**
   * Stores the first touch Y position so the bottom sheet can decide whether a
   * swipe should expand or collapse it.
   */
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartY.current = e.touches[0]?.clientY ?? 0;
    didSheetSwipe.current = false;
  };

  /**
   * Converts a vertical swipe into one of the three bottom-sheet states. The
   * threshold avoids accidental state changes while the user scrolls content.
   */
  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const touchEndY = e.changedTouches[0]?.clientY ?? 0;
    const diffY = touchEndY - touchStartY.current;

    if (Math.abs(diffY) > 40) {
      didSheetSwipe.current = true;

      if (diffY < 0) {
        setSheetState((prev) => {
          if (prev === "collapsed") return "half";
          return "expanded";
        });
      } else {
        setSheetState((prev) => {
          if (prev === "expanded") return "half";
          return "collapsed";
        });
      }
    }
  };

  /**
   * Cycles the bottom sheet through collapsed, half, and expanded when the grab
   * handle is tapped instead of swiped.
   */
  const handleHandleClick = () => {
    if (didSheetSwipe.current) {
      didSheetSwipe.current = false;
      return;
    }

    setSheetState((prev) => {
      if (prev === "collapsed") return "half";
      if (prev === "half") return "expanded";
      return "collapsed";
    });
  };
  const visibleMemberRoutes = useMemo(
    () => memberRoutes.filter((route) => visibleMemberRouteSet.has(route.id)),
    [memberRoutes, visibleMemberRouteSet],
  );
  const currentWaypoint = routePlan.waypoints.find((waypoint) => waypoint.weather.riskLevel !== "low" || waypoint.stop?.priority === "required") ?? routePlan.waypoints[0] ?? null;
  const visibleMembers = memberLocations.filter((location) => location.userId !== currentUserId).slice(0, 3);
  const visiblePois = pois.slice(0, 3);
  const originSuggestions = buildPlaceSuggestions(origin, placeSuggestions);
  const destinationSuggestions = buildPlaceSuggestions(destination, placeSuggestions);
  const recentPlaceShortcuts = placeSuggestions.filter((place) => place.source === "recent").slice(0, 4);

  /**
   * Toggles the simplified riding view. Ride mode also forces fullscreen map so
   * navigation controls stay large and the surrounding dashboard stays hidden.
   */
  function handleRideModeToggle() {
    setIsRideMode((current) => {
      const next = !current;
      setIsMapFullscreen(next || isMapFullscreen);
      return next;
    });
  }

  /**
   * Opens or closes the map-only layout. Leaving fullscreen also disables ride
   * mode because ride controls depend on the expanded map canvas.
   */
  function handleMapFullscreenToggle() {
    setIsMapFullscreen((current) => {
      const next = !current;

      if (!next) {
        setIsRideMode(false);
      }

      return next;
    });
  }

  useEffect(() => {
    if (!isMapFullscreen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMapFullscreen(false);
      }
    };

    document.body.classList.add("map-fullscreen-active");
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove("map-fullscreen-active");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMapFullscreen]);

  return (
    <section className="route-intel" aria-label="Lộ trình và thời tiết">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Smart Routing</span>
          <h2>{routePlan.title}</h2>
        </div>
        <Map size={22} />
      </div>

      <div className="route-intel-grid">
        <div className={isMapFullscreen ? "route-map-panel map-fullscreen" : "route-map-panel"} data-ride-mode={isRideMode ? "on" : "off"}>
          <button
            className={isRideMode ? "ride-mode-button active" : "ride-mode-button"}
            type="button"
            aria-pressed={isRideMode}
            onClick={handleRideModeToggle}
          >
            <Navigation size={17} />
            <span>{isRideMode ? "Thoát đang đi" : "Đang đi"}</span>
          </button>
          <button
            className="map-fullscreen-button"
            type="button"
            aria-label={isMapFullscreen ? "Thu nhỏ bản đồ" : "Phóng to bản đồ"}
            onClick={handleMapFullscreenToggle}
          >
            {isMapFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            <span>{isMapFullscreen ? "Thu nhỏ" : "Toàn màn hình"}</span>
          </button>
          <RouteMap
            currentUserId={currentUserId}
            focusedLocationRequest={focusedLocationRequest}
            isFullscreen={isMapFullscreen}
            isPlacingMapMarker={isPlacingMapMarker}
            mapMarkers={mapMarkers}
            memberRoutes={visibleMemberRoutes}
            memberLocations={memberLocations}
            onDestinationPlaceSelect={onDestinationPlaceSelect}
            onMapMarkerPointSelected={onMapMarkerPointSelected}
            onPlanRouteToMember={onPlanRouteToMember}
            pois={pois}
            routePlan={routePlan}
          />
          <div className="route-map-head">
            <span>
              {routePlan.origin} {" -> "} {routePlan.destination}
            </span>
            <strong>{routePlan.offlinePack.mapTilesMb} MB offline</strong>
          </div>
          <div className="route-alerts">
            <MiniMetric label="Điểm dừng" value={`${routePlan.summary.suggestedStops}`} />
            <MiniMetric label="Thời tiết" value={`${routePlan.summary.weatherAlerts}`} />
            <MiniMetric label="Cửa khẩu" value={`${routePlan.summary.borderAlerts}`} />
          </div>
          {isRideMode && (
            <div className="ride-cockpit" aria-label="Chế độ đang đi">
              <div className="ride-status-card">
                <div>
                  <span className="eyebrow">Đang đi</span>
                  <strong>{routePlan.destination}</strong>
                </div>
                <p>
                  {currentWaypoint
                    ? `${currentWaypoint.weather.condition}, ${currentWaypoint.weather.tempC}°C · mưa ${currentWaypoint.weather.rainChance}%`
                    : "Chưa có dữ liệu thời tiết"}
                </p>
              </div>

              <div className="ride-action-grid">
                <button className={isSharingLocation ? "active" : ""} type="button" onClick={isSharingLocation ? onStopSharingLocation : onStartSharingLocation}>
                  <Navigation size={18} />
                  <span>{isSharingLocation ? "Tắt GPS" : "Chia sẻ GPS"}</span>
                </button>
                <button className="danger" type="button">
                  <TrailMapIcon kind="sos" />
                  <span>SOS</span>
                </button>
              </div>

              <div className="ride-strip">
                {visibleMembers.length ? (
                  visibleMembers.map((location) => (
                    <button key={location.userId} type="button" onClick={() => onPlanRouteToMember(location)} disabled={isPlanningRoute || isUsingCurrentLocation}>
                      <TrailMapIcon kind="member" />
                      <span>{location.displayName || "Thành viên"}</span>
                      <em>Đi gặp</em>
                    </button>
                  ))
                ) : (
                  <p>Chưa có thành viên đang chia sẻ GPS.</p>
                )}
              </div>

              <div className="ride-poi-strip">
                {visiblePois.length ? (
                  visiblePois.map((poi) => (
                    <button key={poi.id} type="button" onClick={() => onPlanRouteToPoi(poi)} disabled={isPlanningRoute || isUsingCurrentLocation}>
                      <TrailMapIcon kind={poi.kind} />
                      <span>{poiKindLabel(poi.kind)}</span>
                      <em>{poi.distanceFromRouteKm} km</em>
                    </button>
                  ))
                ) : (
                  <p>Chưa có quán ăn, chỗ nghỉ hoặc cây xăng gần tuyến.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="route-bottom-sheet" data-state={sheetState}>
          <div
            className="bottom-sheet-handle-container"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={handleHandleClick}
          >
            <div className="bottom-sheet-handle" />
            <div className="bottom-sheet-title">
              <span>{routePlan.destination}</span>
              <small>
                {routePlan.totalDistanceKm} km chặng · {routePlan.summary.weatherAlerts} cảnh báo
              </small>
            </div>
          </div>

          <div className="bottom-sheet-content">
            <form className="route-builder" onSubmit={onPlanRoute}>
              <label className="place-field">
                <span>Điểm đi</span>
                <input value={origin} onChange={(event) => onOriginChange(event.target.value)} placeholder="Điểm xuất phát" />
                <PlaceSuggestionList suggestions={originSuggestions} onSelect={onOriginPlaceSelect} />
              </label>
              <label className="place-field">
                <span>Điểm đến</span>
                <input value={destination} onChange={(event) => onDestinationChange(event.target.value)} placeholder="Điểm đến" />
                <PlaceSuggestionList suggestions={destinationSuggestions} onSelect={onDestinationPlaceSelect} />
              </label>
              {destination.trim() && (
                <a className="google-map-fallback" href={googleMapsSearchUrl(destination)} target="_blank" rel="noreferrer">
                  Không thấy điểm này? Tìm bằng Google Maps
                </a>
              )}
              {originCoordinate && <p className="route-gps-note">Đang dùng GPS làm điểm xuất phát.</p>}
              {recentPlaceShortcuts.length > 0 && (
                <div className="route-place-shortcuts" aria-label="Địa điểm đã dùng gần đây">
                  <span>Gần đây</span>
                  {recentPlaceShortcuts.map((place) => (
                    <button key={place.id} type="button" onClick={() => onDestinationPlaceSelect(place)}>
                      <MapPin size={14} />
                      {place.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="route-builder-actions">
                <button className="location-route-button" type="button" disabled={isPlanningRoute || isUsingCurrentLocation} onClick={onPlanRouteFromCurrentLocation}>
                  <MapPin size={17} />
                  <span>{isUsingCurrentLocation ? "Đang lấy GPS..." : "Từ vị trí của tôi"}</span>
                </button>
                <button type="submit" disabled={isPlanningRoute || isUsingCurrentLocation}>
                  <Navigation size={17} />
                  <span>{isPlanningRoute ? "Đang vẽ..." : "Vẽ tuyến"}</span>
                </button>
                {canCreateMemberRoute && (
                  <button className="member-route-save-button" type="button" disabled={isSavingMemberRoute || isPlanningRoute || isUsingCurrentLocation} onClick={onSaveOwnerRoute}>
                    <Users size={17} />
                    <span>{isSavingMemberRoute ? "Đang lưu..." : "Lưu tuyến riêng"}</span>
                  </button>
                )}
              </div>
            </form>

            <div className="route-side-stack">
              <div className="next-stop-card">
                <span className="eyebrow">Cần chú ý tiếp theo</span>
                <strong>{routePlan.summary.nextCriticalStop ?? "Không có cảnh báo"}</strong>
                <p>{routePlan.waypoints.find((waypoint) => waypoint.name === routePlan.summary.nextCriticalStop)?.weather.advisory ?? "Chặng hiện tại ổn định."}</p>
              </div>

              <div className="poi-card">
                <div className="poi-card-head">
                  <div>
                    <span className="eyebrow">Tiện ích trên đường</span>
                    <strong>{isLoadingPois ? "Đang tìm..." : `${pois.length} địa điểm gần tuyến`}</strong>
                  </div>
                  <MapPin size={18} />
                </div>

                <div className="poi-filter-grid" aria-label="Lọc địa điểm trên map">
                  {poiFilters.map((item) => {
                    return (
                      <button
                        key={item.id}
                        className={poiKinds.includes(item.id) ? "active" : ""}
                        type="button"
                        onClick={() => onTogglePoiKind(item.id)}
                      >
                        <TrailMapIcon kind={item.id} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="poi-list">
                  {pois.length ? (
                    pois.slice(0, 7).map((poi) => (
                      <div className="poi-row" key={poi.id}>
                        <span className={`poi-dot ${poi.kind}`}>
                          <TrailMapIcon kind={poi.kind} />
                        </span>
                        <div>
                          <strong>{poi.name}</strong>
                          <small>
                            {poiKindLabel(poi.kind)} · cách tuyến {poi.distanceFromRouteKm} km
                          </small>
                        </div>
                        <button type="button" disabled={isPlanningRoute || isUsingCurrentLocation} onClick={() => onPlanRouteToPoi(poi)}>
                          Tới
                        </button>
                        <button type="button" disabled={isSavingMapMarker} onClick={() => onSavePoiAsMarker(poi)}>
                          Lưu
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>{isLoadingPois ? "Đang lấy địa điểm từ OpenStreetMap." : "Chưa có quán ăn, chỗ nghỉ hoặc cây xăng gần tuyến này."}</p>
                  )}
                </div>
              </div>

              <div className="group-location-card">
                <div className="group-location-head">
                  <div>
                    <span className="eyebrow">GPS nhóm</span>
                    <strong>{memberLocations.length} đang chia sẻ</strong>
                  </div>
                  <button
                    className={isSharingLocation ? "location-share-button active" : "location-share-button"}
                    type="button"
                    onClick={isSharingLocation ? onStopSharingLocation : onStartSharingLocation}
                  >
                    <Navigation size={16} />
                    <span>{isSharingLocation ? "Tắt" : "Bật"}</span>
                  </button>
                </div>

                {locationShareStatus !== "idle" && <p className={`location-share-note ${locationShareStatus}`}>{locationShareStatusText(locationShareStatus)}</p>}

                <div className="group-location-list">
                  {memberLocations.length ? (
                    memberLocations.map((location) => (
                      <button
                        className={location.userId === currentUserId ? "group-location-row self" : "group-location-row"}
                        type="button"
                        key={location.userId}
                        disabled={location.userId === currentUserId || isPlanningRoute || isUsingCurrentLocation}
                        onClick={() => onPlanRouteToMember(location)}
                      >
                        <span>{createLocationInitials(location.displayName || location.userId)}</span>
                        <div>
                          <strong>{location.userId === currentUserId ? "Bạn" : location.displayName || "Thành viên"}</strong>
                          <small>{formatLocationTime(location.sharedAt)}</small>
                        </div>
                        {location.userId !== currentUserId && <em>Đi gặp</em>}
                      </button>
                    ))
                  ) : (
                    <p>Chưa ai bật chia sẻ GPS.</p>
                  )}
                </div>
              </div>

              <div className="member-route-card">
                <div className="member-route-head">
                  <div>
                    <span className="eyebrow">Tuyến thành viên</span>
                    <strong>{memberRoutes.length} tuyến riêng</strong>
                  </div>
                  <Users size={18} />
                </div>

                <div className="member-route-list">
                  {memberRoutes.length ? (
                    memberRoutes.map((route) => {
                      const isRouteVisible = visibleMemberRouteSet.has(route.id);

                      return (
                        <div className={isRouteVisible ? "member-route-row" : "member-route-row hidden"} key={route.id}>
                          <span style={{ background: memberRouteColor(route.userId) }} />
                          <div>
                            <strong>{route.displayName}</strong>
                            <small>
                              {route.routePlan.totalDistanceKm} km · {formatDuration(route.routePlan.durationMinutes)}
                            </small>
                          </div>
                          <button
                            className={isRouteVisible ? "member-route-visible-button active" : "member-route-visible-button"}
                            type="button"
                            onClick={() => onToggleMemberRoute(route.id)}
                          >
                            {isRouteVisible ? "Ẩn" : "Hiện"}
                          </button>
                          {(route.userId === currentUserId || canManageMemberRoutes) && (
                            <button className="member-route-delete-button" type="button" disabled={deletingMemberRouteId === route.id} onClick={() => onDeleteMemberRoute(route)}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p>Chưa có tuyến riêng của thành viên.</p>
                  )}
                </div>
              </div>

              <form className="map-marker-card" onSubmit={onCreateMapMarker}>
                <div className="map-marker-head">
                  <div>
                    <span className="eyebrow">Đánh dấu</span>
                    <strong>{mapMarkers.length} điểm trên map</strong>
                  </div>
                  <button className={isPlacingMapMarker ? "map-pick-button active" : "map-pick-button"} type="button" onClick={onToggleMapMarkerPlacement}>
                    <MapPin size={15} />
                    <span>{isPlacingMapMarker ? "Đang chọn" : "Chọn điểm"}</span>
                  </button>
                </div>

                <div className="marker-kind-grid" aria-label="Loại điểm đánh dấu">
                  {mapMarkerKinds.map((item) => {
                    return (
                      <button
                        key={item.id}
                        className={mapMarkerKind === item.id ? "active" : ""}
                        type="button"
                        onClick={() => onMapMarkerKindChange(item.id)}
                      >
                        <TrailMapIcon kind={item.id} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>

                <input value={mapMarkerLabel} onChange={(event) => onMapMarkerLabelChange(event.target.value)} placeholder="Tên điểm đánh dấu" />

                <p className={pendingMapMarker ? "marker-coordinate selected" : "marker-coordinate"}>
                  {pendingMapMarker ? `${pendingMapMarker.lat.toFixed(5)}, ${pendingMapMarker.lng.toFixed(5)}` : "Bấm Chọn điểm rồi chạm vào bản đồ."}
                </p>

                <button className="map-marker-save" type="submit" disabled={!pendingMapMarker || isSavingMapMarker}>
                  {isSavingMapMarker ? "Đang lưu" : "Lưu điểm"}
                </button>

                <div className="map-marker-list">
                  {mapMarkers.length ? (
                    mapMarkers.slice(0, 5).map((marker) => (
                      <div className="map-marker-row" key={marker.id}>
                        <span className={`map-marker-dot ${marker.kind}`}>
                          <TrailMapIcon kind={marker.kind} />
                        </span>
                        <div>
                          <strong>{marker.label}</strong>
                          <small>{marker.displayName} - {formatLocationTime(marker.createdAt)}</small>
                        </div>
                        <button type="button" onClick={() => onPlanRouteToMapMarker(marker)}>
                          Tới
                        </button>
                        <button type="button" disabled={deletingMapMarkerId === marker.id} onClick={() => onDeleteMapMarker(marker)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>Chưa có điểm đánh dấu nào.</p>
                  )}
                </div>
              </form>
            </div>

            <div className="waypoint-list">
              {routePlan.waypoints.map((waypoint) => (
                <WaypointCard key={waypoint.id} waypoint={waypoint} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type RouteMapProps = {
  currentUserId: string;
  focusedLocationRequest: FocusedLocationRequest | null;
  isFullscreen: boolean;
  isPlacingMapMarker: boolean;
  mapMarkers: ApiMapMarker[];
  memberRoutes: ApiMemberRoute[];
  memberLocations: ApiMemberLocation[];
  onDestinationPlaceSelect: (place: SavedPlace) => void;
  onMapMarkerPointSelected: (point: ApiGeoPoint) => void;
  onPlanRouteToMember: (location: ApiMemberLocation) => void;
  pois: ApiTripPoi[];
  routePlan: ApiRoutePlan;
};

/**
 * Chooses the available map provider for the route cockpit. Google Maps is used
 * only when configured; otherwise the OpenStreetMap fallback keeps the app
 * usable without paid map keys.
 */
function RouteMap(props: RouteMapProps) {
  // Google Maps is used only when a public API key is configured.
  // Otherwise the app falls back to Leaflet/OpenStreetMap so the product still works on free hosting.
  if (googleMapsApiKey) {
    return <GoogleRouteMap {...props} />;
  }

  return <OpenStreetRouteMap {...props} />;
}

/**
 * Google Maps implementation of the route cockpit. It handles provider-specific
 * overlays, Places search, and map resizing while the parent component keeps the
 * provider-independent trip state.
 */
function GoogleRouteMap({
  currentUserId,
  focusedLocationRequest,
  isFullscreen,
  isPlacingMapMarker,
  mapMarkers,
  memberRoutes,
  memberLocations,
  onDestinationPlaceSelect,
  onMapMarkerPointSelected,
  onPlanRouteToMember,
  pois,
  routePlan,
}: RouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<Array<google.maps.MVCObject>>([]);
  const searchMarkerRef = useRef<google.maps.Marker | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selectedPlace, setSelectedPlace] = useState<SavedPlace | null>(null);

  const clearGoogleOverlays = useCallback(() => {
    // Google Maps overlays must be detached from the map before drawing the next route.
    // This prevents duplicate polylines/markers after a live refresh.
    for (const overlay of overlaysRef.current) {
      if ("setMap" in overlay && typeof overlay.setMap === "function") {
        overlay.setMap(null);
      }
    }

    overlaysRef.current = [];
    searchMarkerRef.current?.setMap(null);
    searchMarkerRef.current = null;
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (!map) {
      return undefined;
    }

    // Fullscreen changes alter the DOM size before Google Maps knows about it.
    // A delayed resize keeps tiles and markers aligned after the animation finishes.
    const timer = window.setTimeout(() => {
      google.maps.event.trigger(map, "resize");
    }, 220);

    return () => window.clearTimeout(timer);
  }, [isFullscreen]);

  useEffect(() => {
    let cancelled = false;
    const points = routePlan.geometry.length ? routePlan.geometry : routePlan.waypoints.map((waypoint) => waypoint.coordinate);

    if (!points.length || !mapElementRef.current) {
      setStatus("error");
      return;
    }

    setStatus("loading");

    void loadGoogleMaps()
      .then((googleMaps) => {
        if (cancelled || !mapElementRef.current) {
          return;
        }

        // Rebuild all Google overlays from the latest route snapshot.
        // The map instance is recreated here because Google rendering is optional and route updates are not continuous.
        clearGoogleOverlays();
        const routePath = points.map((point) => ({ lat: point.lat, lng: point.lng }));
        const map = new googleMaps.maps.Map(mapElementRef.current, {
          center: routePath[0],
          clickableIcons: true,
          fullscreenControl: false,
          gestureHandling: "greedy",
          mapTypeControl: false,
          streetViewControl: false,
          zoom: 12,
        });

        mapInstanceRef.current = map;

        const bounds = new googleMaps.maps.LatLngBounds();
        routePath.forEach((point) => bounds.extend(point));

        const routeLine = new googleMaps.maps.Polyline({
          geodesic: true,
          map,
          path: routePath,
          strokeColor: "#0f766e",
          strokeOpacity: 0.92,
          strokeWeight: 5,
        });
        overlaysRef.current.push(routeLine);

        routePlan.waypoints.forEach((waypoint, index) => {
          const marker = new googleMaps.maps.Marker({
            label: {
              color: "#ffffff",
              fontWeight: "900",
              text: String(index + 1),
            },
            map,
            position: waypoint.coordinate,
            title: waypoint.name,
          });
          marker.addListener("click", () => {
            new googleMaps.maps.InfoWindow({
              content: `<strong>${escapeHtml(waypoint.name)}</strong><br />${escapeHtml(waypoint.eta)} - ${escapeHtml(String(waypoint.distanceFromStartKm))} km`,
            }).open({ anchor: marker, map });
          });
          overlaysRef.current.push(marker);
        });

        for (const poi of pois) {
          const marker = new googleMaps.maps.Marker({
            icon: {
              path: googleMaps.maps.SymbolPath.CIRCLE,
              fillColor: poi.kind === "fuel" ? "#f59e0b" : poi.kind === "lodging" ? "#7c3aed" : "#16a34a",
              fillOpacity: 0.95,
              scale: 7,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
            map,
            position: { lat: poi.latitude, lng: poi.longitude },
            title: poi.name,
          });
          marker.addListener("click", () => {
            new googleMaps.maps.InfoWindow({
              content: `<strong>${escapeHtml(poi.name)}</strong><br />${escapeHtml(poiKindLabel(poi.kind))} - cách tuyến ${escapeHtml(String(poi.distanceFromRouteKm))} km`,
            }).open({ anchor: marker, map });
          });
          overlaysRef.current.push(marker);
        }

        for (const markerItem of mapMarkers) {
          const marker = new googleMaps.maps.Marker({
            map,
            position: { lat: markerItem.latitude, lng: markerItem.longitude },
            title: markerItem.label,
          });
          marker.addListener("click", () => {
            new googleMaps.maps.InfoWindow({
              content: `<strong>${escapeHtml(markerItem.label)}</strong><br />${escapeHtml(mapMarkerKindLabel(markerItem.kind))}`,
            }).open({ anchor: marker, map });
          });
          overlaysRef.current.push(marker);
        }

        for (const location of memberLocations) {
          const label = location.userId === currentUserId ? "Bạn" : location.displayName || "Thành viên";
          const marker = new googleMaps.maps.Marker({
            label: {
              color: "#ffffff",
              fontWeight: "900",
              text: createLocationInitials(label),
            },
            map,
            position: { lat: location.latitude, lng: location.longitude },
            title: label,
          });

          if (location.userId !== currentUserId) {
            marker.addListener("click", () => onPlanRouteToMember(location));
          }

          overlaysRef.current.push(marker);

          if (location.userId === focusedLocationRequest?.userId) {
            map.setCenter({ lat: location.latitude, lng: location.longitude });
            map.setZoom(Math.max(map.getZoom() ?? 15, 15));
          }
        }

        for (const memberRoute of memberRoutes) {
          const memberPoints = memberRoute.routePlan.geometry.length ? memberRoute.routePlan.geometry : memberRoute.routePlan.waypoints.map((waypoint) => waypoint.coordinate);

          if (memberPoints.length < 2) {
            continue;
          }

          const memberLine = new googleMaps.maps.Polyline({
            geodesic: true,
            map,
            path: memberPoints,
            strokeColor: memberRouteColor(memberRoute.userId),
            strokeOpacity: 0.86,
            strokeWeight: 4,
          });
          overlaysRef.current.push(memberLine);
        }

        map.fitBounds(bounds, 28);

        if (searchInputRef.current) {
          const searchBox = new googleMaps.maps.places.SearchBox(searchInputRef.current);
          searchBox.bindTo("bounds", map);
          searchBox.addListener("places_changed", () => {
            const places = searchBox.getPlaces() ?? [];
            const firstPlace = places[0];

            if (!firstPlace?.geometry?.location) {
              return;
            }

            const coordinate = {
              lat: firstPlace.geometry.location.lat(),
              lng: firstPlace.geometry.location.lng(),
            };
            const place: SavedPlace = {
              id: savedPlaceKey(firstPlace.name ?? firstPlace.formatted_address ?? "Google place", coordinate),
              label: firstPlace.name ?? firstPlace.formatted_address ?? "Google place",
              subtitle: firstPlace.formatted_address ?? "Google Places",
              source: "recent",
              coordinate,
              lastUsedAt: new Date().toISOString(),
              useCount: 1,
            };

            searchMarkerRef.current?.setMap(null);
            searchMarkerRef.current = new googleMaps.maps.Marker({
              animation: googleMaps.maps.Animation.DROP,
              map,
              position: coordinate,
              title: place.label,
            });
            map.setCenter(coordinate);
            map.setZoom(Math.max(map.getZoom() ?? 15, 16));
            setSelectedPlace(place);
            onDestinationPlaceSelect(place);
          });
        }

        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      clearGoogleOverlays();
    };
  }, [clearGoogleOverlays, currentUserId, focusedLocationRequest?.userId, mapMarkers, memberLocations, memberRoutes, onDestinationPlaceSelect, onPlanRouteToMember, pois, routePlan]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (!map || !isPlacingMapMarker) {
      return undefined;
    }

    const listener = google.maps.event.addListener(map, "click", (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) {
        return;
      }

      onMapMarkerPointSelected({
        lat: event.latLng.lat(),
        lng: event.latLng.lng(),
      });
    });

    return () => listener.remove();
  }, [isPlacingMapMarker, onMapMarkerPointSelected]);

  if (status === "error") {
    return (
      <OpenStreetRouteMap
        currentUserId={currentUserId}
        focusedLocationRequest={focusedLocationRequest}
        isFullscreen={isFullscreen}
        isPlacingMapMarker={isPlacingMapMarker}
        mapMarkers={mapMarkers}
        memberRoutes={memberRoutes}
        memberLocations={memberLocations}
        onDestinationPlaceSelect={onDestinationPlaceSelect}
        onMapMarkerPointSelected={onMapMarkerPointSelected}
        onPlanRouteToMember={onPlanRouteToMember}
        pois={pois}
        routePlan={routePlan}
      />
    );
  }

  return (
    <div className={isPlacingMapMarker ? "google-map-shell placing" : "google-map-shell"}>
      <div className="google-place-search">
        <MapPin size={16} />
        <input ref={searchInputRef} placeholder="Tìm bằng Google: quán, bãi xe, nhà nghỉ..." />
      </div>
      <div className="google-map-canvas" ref={mapElementRef} />
      {selectedPlace && (
        <div className="google-place-card">
          <strong>{selectedPlace.label}</strong>
          <span>{selectedPlace.subtitle}</span>
          <button type="button" onClick={() => onDestinationPlaceSelect(selectedPlace)}>
            Dùng làm điểm đến
          </button>
        </div>
      )}
      {status !== "ready" && (
        <div className="osm-map-status">
          <MapPin size={18} />
          <span>Đang tải Google Maps...</span>
        </div>
      )}
    </div>
  );
}

/**
 * Leaflet/OpenStreetMap implementation of the route cockpit. This is the free
 * fallback path and includes route polylines, member locations, saved markers,
 * POIs, and live GPS following.
 */
function OpenStreetRouteMap({
  currentUserId,
  focusedLocationRequest,
  isFullscreen,
  isPlacingMapMarker,
  mapMarkers,
  memberRoutes,
  memberLocations,
  onDestinationPlaceSelect,
  onMapMarkerPointSelected,
  onPlanRouteToMember,
  pois,
  routePlan,
}: RouteMapProps) {
  void onDestinationPlaceSelect;
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const leafletModuleRef = useRef<typeof import("leaflet") | null>(null);
  const locationWatchIdRef = useRef<number | null>(null);
  const userMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const userAccuracyRef = useRef<import("leaflet").Circle | null>(null);
  const memberLocationLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const mapMarkerLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const memberRouteLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const poiLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const vietnamSeaLabelLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [status, setStatus] = useState<LeafletMapStatus>("loading");
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [locationStatus, setLocationStatus] = useState<LocationWatchStatus>("idle");

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (!map) {
      return undefined;
    }

    // Leaflet needs invalidateSize after fullscreen/bottom-sheet layout changes,
    // otherwise tiles can appear cropped or controls may be placed incorrectly.
    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 220);

    return () => window.clearTimeout(timer);
  }, [isFullscreen]);

  const clearUserLocationLayer = useCallback(() => {
    userMarkerRef.current?.remove();
    userAccuracyRef.current?.remove();
    userMarkerRef.current = null;
    userAccuracyRef.current = null;
  }, []);

  const clearMemberLocationLayer = useCallback(() => {
    memberLocationLayerRef.current?.remove();
    memberLocationLayerRef.current = null;
  }, []);

  const clearMapMarkerLayer = useCallback(() => {
    mapMarkerLayerRef.current?.remove();
    mapMarkerLayerRef.current = null;
  }, []);

  const clearMemberRouteLayer = useCallback(() => {
    memberRouteLayerRef.current?.remove();
    memberRouteLayerRef.current = null;
  }, []);

  const clearPoiLayer = useCallback(() => {
    poiLayerRef.current?.remove();
    poiLayerRef.current = null;
  }, []);

  const clearVietnamSeaLabelLayer = useCallback(() => {
    vietnamSeaLabelLayerRef.current?.remove();
    vietnamSeaLabelLayerRef.current = null;
  }, []);

  const updateUserPosition = useCallback(async (position: GeolocationPosition) => {
    const map = mapInstanceRef.current;

    if (!map) {
      return;
    }

    const leaflet = leafletModuleRef.current ?? (await import("leaflet"));
    leafletModuleRef.current = leaflet;

    // This is the local "follow my GPS" mode for riding.
    // It updates the blue user marker and heading arrow without sending anything to the backend.
    const latLng = leaflet.latLng(position.coords.latitude, position.coords.longitude);
    const accuracyRadius = Math.max(position.coords.accuracy, 12);

    if (!userAccuracyRef.current) {
      userAccuracyRef.current = leaflet
        .circle(latLng, {
          className: "user-location-radius",
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.16,
          opacity: 0.28,
          radius: accuracyRadius,
          weight: 1,
        })
        .addTo(map);
    } else {
      userAccuracyRef.current.setLatLng(latLng);
      userAccuracyRef.current.setRadius(accuracyRadius);
    }

    if (!userMarkerRef.current) {
      userMarkerRef.current = leaflet
        .marker(latLng, {
          icon: leaflet.divIcon({
            className: "user-location-marker",
            html: '<span class="user-location-heading"></span>',
            iconAnchor: [14, 14],
            iconSize: [28, 28],
          }),
          title: "Vị trí của bạn",
        })
        .bindPopup("Vị trí của bạn")
        .addTo(map);
    } else {
      userMarkerRef.current.setLatLng(latLng);
    }

    const heading = typeof position.coords.heading === "number" && Number.isFinite(position.coords.heading) ? position.coords.heading : null;
    const markerElement = userMarkerRef.current.getElement();

    if (markerElement) {
      markerElement.classList.toggle("has-heading", heading !== null);
      const headingElement = markerElement.querySelector<HTMLElement>(".user-location-heading");

      if (headingElement && heading !== null) {
        headingElement.style.transform = `rotate(${heading}deg)`;
      }
    }

    map.setView(latLng, Math.max(map.getZoom(), 15), {
      animate: true,
    });
    setLocationStatus("watching");
  }, []);

  const stopFollowingUser = useCallback(() => {
    if (locationWatchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(locationWatchIdRef.current);
    }

    locationWatchIdRef.current = null;
    setIsFollowingUser(false);
    setLocationStatus("idle");
    clearUserLocationLayer();
  }, [clearUserLocationLayer]);

  const startFollowingUser = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unavailable");
      return;
    }

    if (locationWatchIdRef.current !== null) {
      return;
    }

    setIsFollowingUser(true);
    setLocationStatus("searching");

    // This watch is separate from "share my location".
    // Following moves only the local map camera; sharing sends GPS to the trip backend.
    locationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        void updateUserPosition(position);
      },
      (error) => {
        if (locationWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(locationWatchIdRef.current);
        }

        locationWatchIdRef.current = null;
        setIsFollowingUser(false);
        setLocationStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    );
  }, [updateUserPosition]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (status !== "ready" || !map) {
      return;
    }

    let cancelled = false;

    void import("leaflet").then((leaflet) => {
      if (cancelled || !mapInstanceRef.current) {
        return;
      }

      leafletModuleRef.current = leaflet;
      // Member GPS is drawn in its own layer so refreshes can replace only these pins
      // without rebuilding the base map or the main route line.
      clearMemberLocationLayer();

      if (!memberLocations.length) {
        return;
      }

      const layer = leaflet.layerGroup();

      let focusedMarker: import("leaflet").Marker | null = null;
      let focusedLatLng: import("leaflet").LatLng | null = null;

      for (const location of memberLocations) {
        const latLng = leaflet.latLng(location.latitude, location.longitude);
        const label = location.userId === currentUserId ? "Bạn" : location.displayName || "Thành viên";
        const initials = createLocationInitials(label);

        const marker = leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              className: location.userId === currentUserId ? "member-location-marker self" : "member-location-marker",
              html: `<img src="${escapeHtml(trailIconPath("member"))}" alt="" aria-hidden="true" /><span>${escapeHtml(initials)}</span>`,
              iconAnchor: [16, 16],
              iconSize: [32, 32],
            }),
            title: label,
          })
          .bindPopup(`<strong>${escapeHtml(label)}</strong><br />Cập nhật ${escapeHtml(formatLocationTime(location.sharedAt))}`);

        if (location.userId !== currentUserId) {
          marker.on("click", () => onPlanRouteToMember(location));
        }

        marker.addTo(layer);

        if (location.userId === focusedLocationRequest?.userId) {
          focusedMarker = marker;
          focusedLatLng = latLng;
        }

        if (location.accuracyMeters && location.accuracyMeters > 0) {
          leaflet
            .circle(latLng, {
              className: "member-location-radius",
              color: location.userId === currentUserId ? "#2563eb" : "#0f766e",
              fillColor: location.userId === currentUserId ? "#3b82f6" : "#14b8a6",
              fillOpacity: 0.08,
              opacity: 0.18,
              radius: Math.max(location.accuracyMeters, 12),
              weight: 1,
            })
            .addTo(layer);
        }
      }

      layer.addTo(map);
      memberLocationLayerRef.current = layer;

      if (focusedLatLng && focusedMarker) {
        map.setView(focusedLatLng, Math.max(map.getZoom(), 15), {
          animate: true,
        });
        focusedMarker.openPopup();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clearMemberLocationLayer, currentUserId, focusedLocationRequest?.requestedAt, focusedLocationRequest?.userId, memberLocations, onPlanRouteToMember, status]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (status !== "ready" || !map) {
      return;
    }

    let cancelled = false;

    void import("leaflet").then((leaflet) => {
      if (cancelled || !mapInstanceRef.current) {
        return;
      }

      leafletModuleRef.current = leaflet;
      // POIs are independent from the route layer; changing filters only redraws this layer.
      clearPoiLayer();

      if (!pois.length) {
        return;
      }

      const layer = leaflet.layerGroup();

      for (const poi of pois) {
        const latLng = leaflet.latLng(poi.latitude, poi.longitude);
        leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              className: `poi-marker ${poi.kind}`,
              html: `<img src="${escapeHtml(poiIconPath(poi.kind))}" alt="" aria-hidden="true" />`,
              iconAnchor: [14, 28],
              iconSize: [28, 28],
            }),
            title: poi.name,
          })
          .bindPopup(
            `<strong>${escapeHtml(poi.name)}</strong><br />${escapeHtml(poiKindLabel(poi.kind))} - cách tuyến ${escapeHtml(String(poi.distanceFromRouteKm))} km`,
          )
          .addTo(layer);
      }

      layer.addTo(map);
      poiLayerRef.current = layer;
    });

    return () => {
      cancelled = true;
    };
  }, [clearPoiLayer, pois, status]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (status !== "ready" || !map) {
      return;
    }

    let cancelled = false;

    void import("leaflet").then((leaflet) => {
      if (cancelled || !mapInstanceRef.current) {
        return;
      }

      leafletModuleRef.current = leaflet;
      clearMapMarkerLayer();

      if (!mapMarkers.length) {
        return;
      }

      const layer = leaflet.layerGroup();

      for (const marker of mapMarkers) {
        const latLng = leaflet.latLng(marker.latitude, marker.longitude);
        leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              className: `map-marker-pin ${marker.kind}`,
              html: `<img src="${escapeHtml(mapMarkerIconPath(marker.kind))}" alt="" aria-hidden="true" />`,
              iconAnchor: [16, 32],
              iconSize: [32, 32],
            }),
            title: marker.label,
          })
          .bindPopup(
            `<strong>${escapeHtml(marker.label)}</strong><br />${escapeHtml(mapMarkerKindLabel(marker.kind))} - ${escapeHtml(marker.displayName)}<br />${escapeHtml(formatLocationTime(marker.createdAt))}`,
          )
          .addTo(layer);
      }

      layer.addTo(map);
      mapMarkerLayerRef.current = layer;
    });

    return () => {
      cancelled = true;
    };
  }, [clearMapMarkerLayer, mapMarkers, status]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (status !== "ready" || !map) {
      return;
    }

    let cancelled = false;

    void import("leaflet").then((leaflet) => {
      if (cancelled || !mapInstanceRef.current) {
        return;
      }

      leafletModuleRef.current = leaflet;
      clearMemberRouteLayer();

      if (!memberRoutes.length) {
        return;
      }

      const layer = leaflet.layerGroup();

      memberRoutes.forEach((memberRoute) => {
        const points = memberRoute.routePlan.geometry.length ? memberRoute.routePlan.geometry : memberRoute.routePlan.waypoints.map((waypoint) => waypoint.coordinate);
        const latLngs = points.map((point) => leaflet.latLng(point.lat, point.lng));

        if (latLngs.length < 2) {
          return;
        }

        const color = memberRouteColor(memberRoute.userId);
        const labelPoint = latLngs[Math.floor(latLngs.length / 2)]!;

        leaflet
          .polyline(latLngs, {
            className: "member-route-line",
            color,
            dashArray: "9 8",
            lineCap: "round",
            lineJoin: "round",
            opacity: 0.92,
            weight: 5,
          })
          .bindPopup(`<strong>Tuyến của ${escapeHtml(memberRoute.displayName)}</strong><br />${escapeHtml(String(memberRoute.routePlan.totalDistanceKm))} km`)
          .addTo(layer);

        leaflet
          .marker(labelPoint, {
            icon: leaflet.divIcon({
              className: "member-route-label",
              html: `<span style="--member-route-color:${escapeHtml(color)}">${escapeHtml(memberRoute.displayName)}</span>`,
              iconAnchor: [54, 14],
              iconSize: [108, 28],
            }),
            interactive: false,
          })
          .addTo(layer);
      });

      layer.addTo(map);
      memberRouteLayerRef.current = layer;
    });

    return () => {
      cancelled = true;
    };
  }, [clearMemberRouteLayer, memberRoutes, status]);

  useEffect(() => {
    const map = mapInstanceRef.current;

    if (status !== "ready" || !map || !isPlacingMapMarker) {
      return;
    }

    const handleClick = (event: import("leaflet").LeafletMouseEvent) => {
      onMapMarkerPointSelected({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    };

    map.on("click", handleClick);

    return () => {
      map.off("click", handleClick);
    };
  }, [isPlacingMapMarker, onMapMarkerPointSelected, status]);

  useEffect(() => {
    let cancelled = false;
    const points = routePlan.geometry.length ? routePlan.geometry : routePlan.waypoints.map((waypoint) => waypoint.coordinate);

    if (!points.length || !mapElementRef.current) {
      setStatus("error");
      return;
    }

    setStatus("loading");

    void import("leaflet")
      .then((leaflet) => {
        if (cancelled || !mapElementRef.current) {
          return;
        }

        mapInstanceRef.current?.remove();
        clearUserLocationLayer();
        clearMemberLocationLayer();
        clearMapMarkerLayer();
        clearMemberRouteLayer();
        clearPoiLayer();
        clearVietnamSeaLabelLayer();
        leafletModuleRef.current = leaflet;

        const latLngs = points.map((point) => leaflet.latLng(point.lat, point.lng));
        const map = leaflet.map(mapElementRef.current, {
          attributionControl: true,
          scrollWheelZoom: true,
          zoomControl: true,
        });

        mapInstanceRef.current = map;

        leaflet
          .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
          })
          .addTo(map);

        const vietnamSeaLabelLayer = leaflet.layerGroup();

        for (const seaLabel of vietnamSeaLabels) {
          leaflet
            .marker(leaflet.latLng(seaLabel.lat, seaLabel.lng), {
              icon: leaflet.divIcon({
                className: "vietnam-sea-label",
                html: `<span>${escapeHtml(seaLabel.label)}</span>`,
                iconAnchor: [84, 17],
                iconSize: [168, 34],
              }),
              interactive: false,
              keyboard: false,
              title: seaLabel.label,
            })
            .addTo(vietnamSeaLabelLayer);
        }

        vietnamSeaLabelLayer.addTo(map);
        vietnamSeaLabelLayerRef.current = vietnamSeaLabelLayer;

        leaflet
          .polyline(latLngs, {
            color: "#0f766e",
            lineCap: "round",
            lineJoin: "round",
            opacity: 0.9,
            weight: 5,
          })
          .addTo(map);

        routePlan.waypoints.forEach((waypoint, index) => {
          const latLng = leaflet.latLng(waypoint.coordinate.lat, waypoint.coordinate.lng);

          leaflet
            .marker(latLng, {
              icon: leaflet.divIcon({
                className: `route-marker risk-${waypoint.weather.riskLevel}`,
                html: `<span>${index + 1}</span>`,
                iconAnchor: [14, 14],
                iconSize: [28, 28],
              }),
              title: `${waypoint.eta} - ${waypoint.name}`,
            })
            .bindPopup(`<strong>${waypoint.name}</strong><br />${waypoint.eta} - ${waypoint.distanceFromStartKm} km`)
            .addTo(map);
        });

        map.fitBounds(leaflet.latLngBounds(latLngs), {
          padding: [28, 28],
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      clearUserLocationLayer();
      clearMemberLocationLayer();
      clearMapMarkerLayer();
      clearMemberRouteLayer();
      clearPoiLayer();
      clearVietnamSeaLabelLayer();
    };
  }, [clearMapMarkerLayer, clearMemberLocationLayer, clearMemberRouteLayer, clearPoiLayer, clearUserLocationLayer, clearVietnamSeaLabelLayer, routePlan]);

  useEffect(() => {
    return () => {
      if (locationWatchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current);
      }
    };
  }, []);

  return (
    <div className={isPlacingMapMarker ? "osm-map-shell placing" : "osm-map-shell"}>
      <div className="osm-map-canvas" ref={mapElementRef} />
      {status === "ready" && (
        <div className="osm-map-controls">
          <button
            className={isFollowingUser ? "map-follow-button active" : "map-follow-button"}
            type="button"
            onClick={isFollowingUser ? stopFollowingUser : startFollowingUser}
          >
            <Navigation size={15} />
            <span>{isFollowingUser ? "Đang theo GPS" : "Theo GPS"}</span>
          </button>
        </div>
      )}
      {locationStatus !== "idle" && (
        <div className={`location-watch-note ${locationStatus}`}>
          <span>{locationWatchStatusText(locationStatus)}</span>
        </div>
      )}
      {status !== "ready" && (
        <div className="osm-map-status">
          <MapPin size={18} />
          <span>{leafletMapStatusText(status)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Renders one waypoint in the Strava-like trip timeline with weather, stop, and
 * border checklist context.
 */
function WaypointCard({ waypoint }: { waypoint: ApiRouteWaypoint }) {
  return (
    <article className={`waypoint-card risk-${waypoint.weather.riskLevel}`}>
      <div className="waypoint-topline">
        <div className="waypoint-pin">
          <MapPin size={16} />
        </div>
        <div>
          <h3>{waypoint.name}</h3>
          <p>
            {waypoint.eta} - {waypoint.distanceFromStartKm} km - {waypoint.province}
          </p>
        </div>
      </div>

      <div className="weather-row">
        <CloudRain size={16} />
        <div>
          <strong>{waypoint.weather.condition}</strong>
          <span>
            {waypoint.weather.tempC}°C, mưa {waypoint.weather.rainChance}%, gió {waypoint.weather.windKph} km/h
            {typeof waypoint.weather.precipitationMm === "number" ? `, lượng mưa ${waypoint.weather.precipitationMm} mm` : ""}
          </span>
        </div>
      </div>

      <p className="road-note">{waypoint.roadNote}</p>
      {waypoint.weather.source && <span className={`weather-source ${waypoint.weather.source}`}>{weatherSourceLabel(waypoint.weather.source)}</span>}

      <div className="waypoint-actions">
        {waypoint.stop && (
          <span className={`stop-pill ${waypoint.stop.priority}`}>
            {stopIcon(waypoint.stop.kind)}
            {waypoint.stop.label}
          </span>
        )}
        {waypoint.borderChecklist.length > 0 && <span className="stop-pill required">Giấy tờ: {waypoint.borderChecklist.length}</span>}
      </div>
    </article>
  );
}

/**
 * Compact label/value metric used in recap panels where dense scanning matters.
 */
function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Dashboard summary tile used for high-level trip stats.
 */
function SummaryTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="summary-tile">
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

/**
 * Displays a consistent member avatar from either the lightweight fallback
 * member type or the richer trip member profile type.
 */
function Avatar({ member }: { member: Member | TripMemberView }) {
  const avatarColor = "avatarColor" in member ? member.avatarColor : "teal";
  const statusEmoji = "statusEmoji" in member ? member.statusEmoji : "";

  return (
    <span className={`avatar avatar-${avatarColor}`}>
      {statusEmoji ? <em>{statusEmoji}</em> : null}
      <strong>{member.initials}</strong>
    </span>
  );
}

/**
 * Converts the internal split mode enum into the short label used in segmented
 * controls.
 */
function modeLabel(mode: SplitMode): string {
  if (mode === "percent") {
    return "%";
  }

  if (mode === "share") {
    return "Phần";
  }

  return "Đều";
}

/**
 * Formats local sync timestamps without seconds to reduce visual noise.
 */
function formatSyncTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Safely formats chat timestamps and falls back to "just now" for optimistic
 * or malformed local messages.
 */
function formatChatTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "vừa xong";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Merges chat messages by id so reconnects and live sync retries do not render
 * duplicate messages.
 */
function appendUniqueMessages(current: ApiTripMessage[], nextMessages: ApiTripMessage[]): ApiTripMessage[] {
  const seen = new Set(current.map((message) => message.id));
  const merged = [...current];

  for (const message of nextMessages) {
    if (!seen.has(message.id)) {
      seen.add(message.id);
      merged.push(message);
    }
  }

  return merged.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

/**
 * Converts server-sent live event types into short notification text.
 */
function liveEventLabel(type: ApiTripLiveEvent["type"]): string {
  if (type === "expense_created") {
    return "có chi phí mới";
  }

  if (type === "member_changed") {
    return "nhóm vừa đổi";
  }

  if (type === "member_route_changed") {
    return "tuyến riêng vừa đổi";
  }

  if (type === "message_created") {
    return "có tin nhắn mới";
  }

  if (type === "trip_changed") {
    return "chuyến đi vừa đổi trạng thái";
  }

  if (type === "trip_deleted") {
    return "chuyến đi vừa bị xóa";
  }

  if (type === "location_updated") {
    return "GPS nhóm vừa cập nhật";
  }

  if (type === "location_stopped") {
    return "có người tắt GPS";
  }

  return "tuyến vừa đổi";
}

/**
 * Returns the active CSS class for mobile tab buttons.
 */
function tabButtonClass(activeTab: MobileTab, tab: MobileTab): string {
  return activeTab === tab ? "active" : "";
}

/**
 * Maps the internal mobile tab id to the label shown in the app navigation.
 */
function navTabLabel(tab: MobileTab): string {
  if (tab === "expenses") {
    return "Chi phí";
  }

  if (tab === "group") {
    return "Nhóm";
  }

  if (tab === "recap") {
    return "Tổng kết";
  }

  return "Bản đồ";
}

/**
 * Converts RBAC roles into human-readable room labels.
 */
function roleLabel(role: ApiTripRole): string {
  if (role === "owner") {
    return "Chủ phòng";
  }

  if (role === "editor") {
    return "Thành viên";
  }

  return "Chỉ xem";
}

/**
 * Builds the class list for the draggable/collapsible app navigation rail.
 */
function appNavRailClass(isOpen: boolean, isMinimized: boolean, side: "left" | "right"): string {
  return [
    "app-nav-rail",
    isOpen && !isMinimized ? "open" : "",
    isMinimized ? "minimized" : "",
    side === "right" ? "side-right" : "side-left",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Translates the expense form state into the API split model. Keeping this
 * conversion centralized avoids sending mismatched split payloads to the server.
 */
function buildSplitPayload(splitMode: SplitMode, selectedMemberIds: string[], values: Record<string, string>): ApiExpenseSplit {
  if (splitMode === "equal") {
    return {
      type: "equal",
      userIds: selectedMemberIds,
    };
  }

  if (splitMode === "percent") {
    return {
      type: "percentage",
      shares: selectedMemberIds.map((userId) => ({
        userId,
        percentage: values[userId] || "0",
      })),
    };
  }

  return {
    type: "share",
    shares: selectedMemberIds.map((userId) => ({
      userId,
      shares: values[userId] || "1",
    })),
  };
}

/**
 * Counts how many members participate in an expense regardless of split mode.
 */
function participantCount(expense: ApiExpense): number {
  if (expense.split.type === "equal") {
    return expense.split.userIds.length;
  }

  return expense.split.shares.length;
}

/**
 * Converts the backend trip member record into the UI-friendly member view with
 * avatar defaults and display fallbacks.
 */
function mapTripMember(member: ApiTripMember): TripMemberView {
  const travelStatus = member.travelStatus ?? "riding";

  return {
    id: member.userId,
    name: member.displayName,
    initials: createInitials(member.displayName),
    role: member.role,
    active: member.active !== false,
    removedAt: member.removedAt ?? null,
    phoneNumber: member.phoneNumber ?? null,
    homeBase: member.homeBase ?? null,
    travelStatus,
    statusEmoji: member.statusEmoji || travelStatusEmoji(travelStatus),
    avatarColor: member.avatarColor ?? "teal",
    backgroundKey: member.backgroundKey ?? "forest",
  };
}

/**
 * Seeds the editable profile form from the current member view.
 */
function memberToProfileDraft(member: TripMemberView): MemberProfileDraft {
  return {
    displayName: member.name,
    phoneNumber: member.phoneNumber ?? "",
    homeBase: member.homeBase ?? "",
    travelStatus: member.travelStatus,
    statusEmoji: member.statusEmoji || travelStatusEmoji(member.travelStatus),
    avatarColor: member.avatarColor,
    backgroundKey: member.backgroundKey,
  };
}

/**
 * Looks up the label for a member travel status.
 */
function travelStatusLabel(status: ApiTripMemberTravelStatus): string {
  return travelStatusOptions.find((option) => option.id === status)?.label ?? "Đang chạy";
}

/**
 * Looks up the emoji for a member travel status, with a safe riding fallback.
 */
function travelStatusEmoji(status: ApiTripMemberTravelStatus): string {
  return travelStatusOptions.find((option) => option.id === status)?.emoji ?? "🛵";
}

/**
 * Sanitizes a phone number before exposing it as a tel: link. Short or invalid
 * values return null so the UI does not create unusable call buttons.
 */
function safeTelHref(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/[^\d+]/g, "");

  if (normalized.replace(/\D/g, "").length < 6) {
    return null;
  }

  return `tel:${normalized}`;
}

/**
 * Builds an external Google Maps search URL for fallback place lookups.
 */
function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;
}

/**
 * Creates two-character initials for avatar fallbacks.
 */
function createInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .padEnd(2, "?");
}

/**
 * Creates initials for map location markers.
 */
function createLocationInitials(name: string): string {
  return createInitials(name).slice(0, 2);
}

/**
 * Formats GPS/presence timestamps for compact presence rows.
 */
function formatLocationTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "vừa xong";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Formats full date/time labels for trip lifecycle and recap screens.
 */
function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "chưa rõ";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Converts a duration in minutes into a short Vietnamese hour/minute label.
 */
function formatDuration(minutes: number): string {
  if (!minutes) {
    return "0 giờ";
  }

  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/**
 * Converts trip lifecycle status into user-facing text.
 */
function tripStatusLabel(status: ApiTripStatus): string {
  if (status === "completed") {
    return "Đã kết thúc";
  }

  if (status === "archived") {
    return "Đã lưu trữ";
  }

  return "Đang đi";
}

/**
 * Aggregates expenses by category for the trip recap card.
 */
function summarizeExpensesByCategory(expenses: ApiExpense[]): Array<{ category: string; total: number }> {
  const totals = new globalThis.Map<string, number>();

  for (const expense of expenses) {
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + toVnd(Number(expense.money.amount), expense.money.currency));
  }

  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((left, right) => right.total - left.total);
}

/**
 * Counts saved map markers by kind for recap summaries.
 */
function summarizeMapMarkers(markers: ApiMapMarker[]): Array<{ kind: ApiMapMarkerKind; count: number }> {
  const totals = new globalThis.Map<ApiMapMarkerKind, number>();

  for (const marker of markers) {
    totals.set(marker.kind, (totals.get(marker.kind) ?? 0) + 1);
  }

  return [...totals.entries()].map(([kind, count]) => ({ kind, count }));
}

/**
 * Resolves an expense category id to the configured UI label.
 */
function expenseCategoryLabel(category: string): string {
  return categories.find((item) => item.id === category)?.label ?? category;
}

/**
 * Resolves saved map marker types to labels used in markers and recaps.
 */
function mapMarkerKindLabel(kind: ApiMapMarkerKind): string {
  if (kind === "meetup") {
    return "Hẹn gặp";
  }

  if (kind === "fuel") {
    return "Đổ xăng";
  }

  if (kind === "food") {
    return "Quán ăn";
  }

  if (kind === "lodging") {
    return "Ngủ nghỉ";
  }

  if (kind === "repair") {
    return "Sửa xe";
  }

  if (kind === "warning") {
    return "Cảnh báo";
  }

  return "Ping";
}

/**
 * Resolves POI provider kinds to rider-friendly labels.
 */
function poiKindLabel(kind: ApiTripPoiKind): string {
  if (kind === "fuel") {
    return "Cây xăng";
  }

  if (kind === "lodging") {
    return "Khách sạn/nhà trọ";
  }

  return "Quán ăn";
}

/**
 * Escapes HTML before injecting marker labels into Leaflet popup strings. This
 * prevents saved marker names from becoming executable HTML.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Finds a member by id and returns a stable fallback when old expenses reference
 * a removed or unknown user.
 */
function findMember(members: TripMemberView[], memberId: string): Member {
  return members.find((member) => member.id === memberId) ?? { id: memberId, name: "Unknown", initials: "??" };
}

/**
 * Adds a failed/offline expense mutation to the local queue without duplicating
 * an existing optimistic mutation id.
 */
function enqueueExpense(item: OfflineExpenseQueueItem) {
  const current = readQueuedExpenses();

  if (current.some((expense) => expense.id === item.id)) {
    return;
  }

  writeQueuedExpenses([...current, item]);
}

/**
 * Reads and validates the offline expense queue from localStorage.
 */
function readQueuedExpenses(): OfflineExpenseQueueItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(expenseQueueCacheKey());

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isQueuedExpense) : [];
  } catch {
    return [];
  }
}

/**
 * Persists the offline expense queue for later sync.
 */
function writeQueuedExpenses(items: OfflineExpenseQueueItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(expenseQueueCacheKey(), JSON.stringify(items));
}

/**
 * Converts a queued offline expense into an optimistic expense row so the UI can
 * show the item immediately while sync is pending.
 */
function queuedExpenseToApiExpense(item: OfflineExpenseQueueItem): ApiExpense {
  return {
    id: item.id,
    title: item.payload.title,
    category: item.payload.category,
    paidByUserId: item.payload.paidByUserId,
    money: {
      amount: item.payload.amount,
      currency: item.payload.currency,
    },
    split: item.payload.split,
    createdAt: "Offline",
  };
}

/**
 * Decides whether a create-expense failure should be treated as temporary
 * network loss and queued for retry.
 */
function shouldQueueExpense(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /failed to fetch|network|load failed|fetch/i.test(error.message);
}

/**
 * Creates a client-side mutation id for optimistic/offline expense writes.
 */
function createClientMutationId(): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
  const id = cryptoApi?.randomUUID ? cryptoApi.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `expense_${id}`;
}

/**
 * Runtime guard for values loaded from the offline expense queue.
 */
function isQueuedExpense(value: unknown): value is OfflineExpenseQueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<OfflineExpenseQueueItem>;
  return typeof item.id === "string" && typeof item.tripId === "string" && typeof item.createdAt === "string" && isExpensePayload(item.payload);
}

/**
 * Runtime guard for queued expense payloads before replaying them to the API.
 */
function isExpensePayload(value: unknown): value is ApiCreateExpensePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<ApiCreateExpensePayload>;
  return (
    typeof payload.title === "string" &&
    typeof payload.category === "string" &&
    typeof payload.paidByUserId === "string" &&
    typeof payload.amount === "string" &&
    typeof payload.currency === "string" &&
    !!payload.split
  );
}

/**
 * Returns the localStorage key for offline expenses.
 */
function expenseQueueCacheKey(): string {
  return "trail-ledger-offline-expense-queue";
}

/**
 * Reads a cached route plan for the active trip and normalizes it before use.
 */
function readCachedRoutePlan(activeTripId: string): ApiRoutePlan | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(routePlanCacheKey(activeTripId));

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { routePlan?: unknown };
    return isCachedRoutePlan(parsed.routePlan) ? normalizeRoutePlan(parsed.routePlan) : null;
  } catch {
    return null;
  }
}

/**
 * Caches the latest route plan so the map can reopen quickly after refreshes.
 */
function writeCachedRoutePlan(routePlan: ApiRoutePlan, activeTripId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const safeRoutePlan = normalizeRoutePlan(routePlan);

  window.localStorage.setItem(
    routePlanCacheKey(activeTripId),
    JSON.stringify({
      cachedAt: new Date().toISOString(),
      routePlan: safeRoutePlan,
    }),
  );
}

/**
 * Builds a stable signature for route plans so effects can detect meaningful
 * route changes without relying on object identity.
 */
function routePlanSignature(routePlan: ApiRoutePlan): string {
  const geometryPoints = routePlan.geometry.length ? routePlan.geometry : routePlan.waypoints.map((waypoint) => waypoint.coordinate);
  const geometrySignature = geometryPoints.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join("|");
  const waypointSignature = routePlan.waypoints.map((waypoint) => `${waypoint.name}:${waypoint.coordinate.lat.toFixed(5)},${waypoint.coordinate.lng.toFixed(5)}`).join("|");

  return [
    routePlan.tripId,
    routePlan.origin,
    routePlan.destination,
    routePlan.totalDistanceKm,
    routePlan.durationMinutes,
    geometrySignature,
    waypointSignature,
  ].join("::");
}

/**
 * Namespaces cached routes by trip to avoid leaking one trip's map into another.
 */
function routePlanCacheKey(activeTripId: string): string {
  return `trail-ledger-route-plan-v2:${activeTripId}`;
}

/**
 * Returns the localStorage key for the user's last selected trip.
 */
function selectedTripCacheKey(): string {
  return "trail-ledger-selected-trip-v2";
}

/**
 * Runtime guard for route plan objects restored from localStorage.
 */
function isCachedRoutePlan(value: unknown): value is ApiRoutePlan {
  if (!value || typeof value !== "object") {
    return false;
  }

  const routePlan = value as Partial<ApiRoutePlan>;
  return (
    typeof routePlan.tripId === "string" &&
    typeof routePlan.title === "string" &&
    typeof routePlan.origin === "string" &&
    typeof routePlan.destination === "string" &&
    Array.isArray(routePlan.geometry) &&
    Array.isArray(routePlan.waypoints)
  );
}

/**
 * Normalizes a route plan from API/cache into a complete shape with safe
 * defaults. This prevents stale cached data from crashing the map UI.
 */
function normalizeRoutePlan(value: ApiRoutePlan): ApiRoutePlan {
  const routePlan = value as Partial<ApiRoutePlan>;
  const waypoints = Array.isArray(routePlan.waypoints) ? routePlan.waypoints.map(normalizeRouteWaypoint).filter((waypoint): waypoint is ApiRouteWaypoint => waypoint !== null) : [];
  const geometry = Array.isArray(routePlan.geometry) ? routePlan.geometry.filter(isGeoPoint) : waypoints.map((waypoint) => waypoint.coordinate);
  const offlinePack = routePlan.offlinePack as Partial<ApiRoutePlan["offlinePack"]> | undefined;
  const summary = routePlan.summary as Partial<ApiRoutePlan["summary"]> | undefined;
  const suggestedStops = safeNumber(summary?.suggestedStops, waypoints.filter((waypoint) => waypoint.stop).length);
  const weatherAlerts = safeNumber(summary?.weatherAlerts, waypoints.filter((waypoint) => waypoint.weather.riskLevel !== "low").length);
  const borderAlerts = safeNumber(summary?.borderAlerts, waypoints.reduce((count, waypoint) => count + waypoint.borderChecklist.length, 0));
  const nextCriticalStop =
    typeof summary?.nextCriticalStop === "string"
      ? summary.nextCriticalStop
      : waypoints.find((waypoint) => waypoint.weather.riskLevel !== "low" || waypoint.stop?.priority === "required")?.name ?? null;

  return {
    tripId: typeof routePlan.tripId === "string" ? routePlan.tripId : "",
    provider: routePlan.provider === "osm" ? "osm" : "starter",
    title: typeof routePlan.title === "string" ? routePlan.title : "Tuyến đường",
    origin: typeof routePlan.origin === "string" ? routePlan.origin : "",
    destination: typeof routePlan.destination === "string" ? routePlan.destination : "",
    totalDistanceKm: safeNumber(routePlan.totalDistanceKm, 0),
    durationMinutes: safeNumber(routePlan.durationMinutes, 0),
    generatedAt: typeof routePlan.generatedAt === "string" ? routePlan.generatedAt : new Date().toISOString(),
    geometry,
    offlinePack: {
      status: "ready",
      mapTilesMb: safeNumber(offlinePack?.mapTilesMb, Math.max(8, Math.ceil(Math.max(geometry.length, waypoints.length) / 20))),
      expiresInHours: safeNumber(offlinePack?.expiresInHours, 72),
    },
    summary: {
      suggestedStops,
      weatherAlerts,
      borderAlerts,
      nextCriticalStop,
    },
    waypoints,
  };
}

/**
 * Normalizes one route waypoint and drops it if it has no valid coordinate.
 */
function normalizeRouteWaypoint(value: ApiRouteWaypoint): ApiRouteWaypoint | null {
  const waypoint = value as Partial<ApiRouteWaypoint>;

  if (!isGeoPoint(waypoint.coordinate)) {
    return null;
  }

  const weather = waypoint.weather as Partial<ApiRouteWaypoint["weather"]> | undefined;
  const stop = waypoint.stop as Partial<NonNullable<ApiRouteWaypoint["stop"]>> | null | undefined;

  return {
    id: typeof waypoint.id === "string" ? waypoint.id : `${waypoint.coordinate.lat},${waypoint.coordinate.lng}`,
    name: typeof waypoint.name === "string" ? waypoint.name : "Điểm dừng",
    province: typeof waypoint.province === "string" ? waypoint.province : "",
    distanceFromStartKm: safeNumber(waypoint.distanceFromStartKm, 0),
    eta: typeof waypoint.eta === "string" ? waypoint.eta : "--:--",
    coordinate: waypoint.coordinate,
    roadNote: typeof waypoint.roadNote === "string" ? waypoint.roadNote : "",
    weather: {
      condition: typeof weather?.condition === "string" ? weather.condition : "Không rõ",
      tempC: safeNumber(weather?.tempC, 0),
      rainChance: safeNumber(weather?.rainChance, 0),
      windKph: safeNumber(weather?.windKph, 0),
      riskLevel: weather?.riskLevel === "medium" || weather?.riskLevel === "high" ? weather.riskLevel : "low",
      advisory: typeof weather?.advisory === "string" ? weather.advisory : "Chưa có cảnh báo thời tiết.",
      source: weather?.source === "open-meteo" || weather?.source === "fallback" || weather?.source === "starter" ? weather.source : "fallback",
      observedAt: typeof weather?.observedAt === "string" ? weather.observedAt : undefined,
      precipitationMm: typeof weather?.precipitationMm === "number" ? weather.precipitationMm : undefined,
    },
    stop:
      stop && typeof stop.label === "string"
        ? {
            kind: isRouteStopKind(stop.kind) ? stop.kind : "rest",
            label: stop.label,
            priority: stop.priority === "required" || stop.priority === "recommended" ? stop.priority : "optional",
          }
        : null,
    borderChecklist: Array.isArray(waypoint.borderChecklist) ? waypoint.borderChecklist.filter((item): item is string => typeof item === "string") : [],
  };
}

/**
 * Runtime guard for geographic coordinates.
 */
function isGeoPoint(value: unknown): value is ApiGeoPoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const point = value as Partial<ApiGeoPoint>;
  return typeof point.lat === "number" && Number.isFinite(point.lat) && typeof point.lng === "number" && Number.isFinite(point.lng);
}

/**
 * Runtime guard for supported route stop kinds.
 */
function isRouteStopKind(value: unknown): value is ApiRouteStopKind {
  return value === "fuel" || value === "rest" || value === "repair" || value === "border";
}

/**
 * Returns finite numeric values and substitutes a fallback for bad cache/API
 * data.
 */
function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Wraps browser geolocation in a Promise so route planning can await the user's
 * current GPS position.
 */
function getCurrentBrowserPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        reject(new Error(error.code === error.PERMISSION_DENIED ? "Cần cho phép quyền vị trí để vẽ từ GPS" : "Không lấy được vị trí hiện tại"));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    );
  });
}

/**
 * Resolves a category id to its configured Lucide icon.
 */
function categoryIcon(category: string) {
  const item = categories.find((entry) => entry.id === category) ?? categories[0]!;
  const Icon = item.icon;
  return <Icon size={18} />;
}

/**
 * Resolves a route stop kind to a compact icon for the waypoint timeline.
 */
function stopIcon(kind: ApiRouteStopKind) {
  if (kind === "fuel") {
    return <Fuel size={14} />;
  }

  if (kind === "repair") {
    return <Bike size={14} />;
  }

  if (kind === "border") {
    return <ShieldCheck size={14} />;
  }

  return <Navigation size={14} />;
}

/**
 * Converts weather source ids into short labels shown on waypoint cards.
 */
function weatherSourceLabel(source: NonNullable<ApiRouteWaypoint["weather"]["source"]>): string {
  if (source === "open-meteo") {
    return "Open-Meteo live";
  }

  if (source === "fallback") {
    return "Dự phòng";
  }

  return "Dữ liệu mẫu";
}

type LeafletMapStatus = "loading" | "ready" | "error";
type LocationWatchStatus = "idle" | "searching" | "watching" | "denied" | "unavailable";
type LocationShareStatus = "idle" | "starting" | "sharing" | "denied" | "unavailable" | "error";

/**
 * Converts Leaflet load status into a map overlay message.
 */
function leafletMapStatusText(status: LeafletMapStatus): string {
  if (status === "error") {
    return "Không tải được bản đồ";
  }

  return "Đang tải OpenStreetMap";
}

/**
 * Converts browser GPS watch state into a rider-facing status line.
 */
function locationWatchStatusText(status: LocationWatchStatus): string {
  if (status === "searching") {
    return "Đang tìm vị trí GPS";
  }

  if (status === "watching") {
    return "Bản đồ đang bám theo bạn";
  }

  if (status === "denied") {
    return "Cần cho phép quyền vị trí";
  }

  if (status === "unavailable") {
    return "Không lấy được vị trí";
  }

  return "";
}

/**
 * Converts group GPS sharing state into a rider-facing status line.
 */
function locationShareStatusText(status: LocationShareStatus): string {
  if (status === "starting") {
    return "Đang xin GPS để chia sẻ cho nhóm";
  }

  if (status === "sharing") {
    return "Đang chia sẻ vị trí mỗi 15 giây";
  }

  if (status === "denied") {
    return "Cần cho phép quyền vị trí";
  }

  if (status === "unavailable") {
    return "Không lấy được GPS trên máy này";
  }

  if (status === "error") {
    return "Chưa gửi được vị trí, sẽ thử lại";
  }

  return "";
}
