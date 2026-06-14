import {
  GoogleAuthProvider,
  OAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";

import { getFirebaseAuth } from "./firebase";
import type { CurrencyCode } from "./settlements";

export const defaultTripId = process.env.NEXT_PUBLIC_DEFAULT_TRIP_ID ?? "";
export const tripId = defaultTripId;

// This is the single API base used by the browser app.
// Local development defaults to localhost:4000; production falls back to the Render backend.
// On real deployments, set NEXT_PUBLIC_API_BASE_URL explicitly so the client never calls the wrong server.
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://travel-4bm4.onrender.com/api/v1" : "http://localhost:4000/api/v1");
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
const appleProvider = new OAuthProvider("apple.com");
appleProvider.addScope("email");
appleProvider.addScope("name");

let currentFirebaseUser: User | null = null;
let authReadyPromise: Promise<User | null> | null = null;

// The Api* types below mirror the backend response contracts.
// Keeping them here makes missing fields, invalid roles, unsupported currencies, and bad coordinates fail at compile time.
// When the backend API changes, update this file in the same commit so TypeScript catches mismatches early.
export type ApiParticipant = {
  id: string;
  displayName?: string;
};

export type ApiTripRole = "owner" | "editor" | "viewer";
export type ApiTripStatus = "active" | "completed" | "archived";
export type ApiTripMemberTravelStatus = "riding" | "resting" | "need-help" | "offline";
export type ApiTripMemberAvatarColor = "teal" | "sky" | "green" | "amber" | "rose" | "violet";
export type ApiTripMemberBackgroundKey = "forest" | "coast" | "mountain" | "night" | "sunrise";

export type ApiTripMember = {
  userId: string;
  displayName: string;
  role: ApiTripRole;
  active: boolean;
  removedAt: string | null;
  phoneNumber?: string | null;
  homeBase?: string | null;
  travelStatus?: ApiTripMemberTravelStatus;
  statusEmoji?: string;
  avatarColor?: ApiTripMemberAvatarColor;
  backgroundKey?: ApiTripMemberBackgroundKey;
};

export type ApiTrip = {
  id: string;
  title: string;
  currency: CurrencyCode;
  role: ApiTripRole;
  status: ApiTripStatus;
  completedAt: string | null;
  archivedAt: string | null;
};

export type ApiExpenseSplit =
  | {
      type: "equal";
      userIds: string[];
    }
  | {
      type: "percentage";
      shares: Array<{ userId: string; percentage: string }>;
    }
  | {
      type: "share";
      shares: Array<{ userId: string; shares: string }>;
    };

export type ApiExpense = {
  id: string;
  title: string;
  category: string;
  paidByUserId: string;
  money: {
    amount: string;
    currency: CurrencyCode;
  };
  split: ApiExpenseSplit;
  createdAt: string;
};

export type ApiCreateExpensePayload = {
  title: string;
  category: string;
  paidByUserId: string;
  amount: string;
  currency: CurrencyCode;
  split: ApiExpenseSplit;
  clientMutationId?: string;
};

export type ApiBalance = {
  userId: string;
  balanceMinor: string;
  currency: CurrencyCode;
};

export type ApiSettlement = {
  fromUserId: string;
  toUserId: string;
  amountMinor: string;
  currency: CurrencyCode;
};

export type ApiUser = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
};

export type ApiRouteRiskLevel = "low" | "medium" | "high";

export type ApiRouteStopKind = "fuel" | "rest" | "repair" | "border";

export type ApiRouteWaypoint = {
  id: string;
  name: string;
  province: string;
  distanceFromStartKm: number;
  eta: string;
  coordinate: {
    lat: number;
    lng: number;
  };
  roadNote: string;
  weather: {
    condition: string;
    tempC: number;
    rainChance: number;
    windKph: number;
    riskLevel: ApiRouteRiskLevel;
    advisory: string;
    source?: "starter" | "open-meteo" | "fallback";
    observedAt?: string;
    precipitationMm?: number;
  };
  stop: {
    kind: ApiRouteStopKind;
    label: string;
    priority: "optional" | "recommended" | "required";
  } | null;
  borderChecklist: string[];
};

export type ApiGeoPoint = {
  lat: number;
  lng: number;
};

export type ApiRoutePlan = {
  tripId: string;
  provider: "starter" | "osm";
  title: string;
  origin: string;
  destination: string;
  totalDistanceKm: number;
  durationMinutes: number;
  generatedAt: string;
  geometry: ApiGeoPoint[];
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
  waypoints: ApiRouteWaypoint[];
};

export type ApiMemberRoute = {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  routePlan: ApiRoutePlan;
  createdAt: string;
  updatedAt: string;
};

export type ApiMemberLocation = {
  tripId: string;
  userId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedMps: number | null;
  headingDegrees: number | null;
  sharedAt: string;
  expiresAt: string;
};

export type ApiMemberLocationAddress = {
  userId: string;
  displayName: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  resolvedAt: string;
};

export type ApiMapMarkerKind = "ping" | "meetup" | "fuel" | "repair" | "warning" | "food" | "lodging";

export type ApiMapMarker = {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  label: string;
  kind: ApiMapMarkerKind;
  latitude: number;
  longitude: number;
  createdAt: string;
};

export type ApiTripPoiKind = "food" | "lodging" | "fuel";

export type ApiTripPoi = {
  id: string;
  name: string;
  kind: ApiTripPoiKind;
  latitude: number;
  longitude: number;
  distanceFromRouteKm: number;
  source: "openstreetmap";
  osmType: "node" | "way" | "relation";
  osmId: number;
  detail: string | null;
};

export type ApiPresenceUser = {
  userId: string;
  displayName: string;
  onlineSince: string;
  connectionCount: number;
};

export type ApiTripMessage = {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string;
};

export type ApiTripLiveEvent = {
  id: string;
  tripId: string;
  type:
    | "expense_created"
    | "member_changed"
    | "route_plan_updated"
    | "member_route_changed"
    | "message_created"
    | "map_marker_changed"
    | "trip_changed"
    | "trip_deleted"
    | "location_updated"
    | "location_stopped"
    | "presence_joined"
    | "presence_left";
  actorUserId: string;
  actorDisplayName?: string;
  createdAt: string;
};

/**
 * Waits for Firebase Auth to finish restoring the current browser session.
 * Use this before calling protected APIs so remembered logins do not look signed out.
 */
export async function getCurrentFirebaseUser(): Promise<User | null> {
  const firebaseAuth = getFirebaseAuth();

  // Firebase may restore an existing session after React has already rendered once.
  // Waiting for one onAuthStateChanged callback prevents the app from treating a valid remembered login as signed out.
  if (firebaseAuth.currentUser) {
    currentFirebaseUser = firebaseAuth.currentUser;
    return currentFirebaseUser;
  }

  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
        currentFirebaseUser = user;
        unsubscribe();
        resolve(user);
      });
    });
  }

  return authReadyPromise;
}

/**
 * Signs in with email/password through Firebase, then asks the backend who this user is.
 * The remember flag controls Firebase persistence, not manual token storage.
 */
export async function login(email: string, password: string, remember = false): Promise<ApiUser> {
  const firebaseAuth = getFirebaseAuth();
  // Security: choose Firebase's managed session persistence instead of writing ID tokens to localStorage ourselves.
  await setPersistence(firebaseAuth, remember ? browserLocalPersistence : browserSessionPersistence);
  await signInWithEmailAndPassword(firebaseAuth, email, password);
  return fetchMe();
}

/**
 * Creates a Firebase email/password account and syncs the display name before loading backend profile data.
 */
export async function registerWithEmail(payload: { displayName: string; email: string; password: string; remember?: boolean }): Promise<ApiUser> {
  const firebaseAuth = getFirebaseAuth();
  // Security: persistence is set before account creation so the session lifetime is explicit.
  await setPersistence(firebaseAuth, payload.remember ? browserLocalPersistence : browserSessionPersistence);
  const credential = await createUserWithEmailAndPassword(firebaseAuth, payload.email, payload.password);
  await updateProfile(credential.user, {
    displayName: payload.displayName,
  });
  await credential.user.getIdToken(true);
  return fetchMe();
}

/**
 * Starts Google OAuth login in a popup and returns the matching backend user profile.
 */
export async function loginWithGoogle(remember = false): Promise<ApiUser> {
  const firebaseAuth = getFirebaseAuth();
  // Security: do not copy OAuth/Firebase tokens into browser storage; the SDK handles refresh safely.
  await setPersistence(firebaseAuth, remember ? browserLocalPersistence : browserSessionPersistence);
  await signInWithPopup(firebaseAuth, googleProvider);
  return fetchMe();
}

/**
 * Starts Apple OAuth login in a popup and returns the matching backend user profile.
 */
export async function loginWithApple(remember = false): Promise<ApiUser> {
  const firebaseAuth = getFirebaseAuth();
  // Security: Apple provider must be enabled in Firebase Console; failed provider setup is surfaced as a normal auth error.
  await setPersistence(firebaseAuth, remember ? browserLocalPersistence : browserSessionPersistence);
  await signInWithPopup(firebaseAuth, appleProvider);
  return fetchMe();
}

/**
 * Sends a Firebase password reset email.
 * The app never handles raw reset tokens directly.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email);
}

/**
 * Signs out from Firebase and clears the cached auth restoration promise.
 */
export async function logout(): Promise<void> {
  await signOut(getFirebaseAuth());
  currentFirebaseUser = null;
  authReadyPromise = null;
}

/**
 * Loads the authenticated user's backend-safe profile.
 */
export async function fetchMe(): Promise<ApiUser> {
  const response = await authedFetch(`${apiBaseUrl}/me`);
  const data = await parseApiResponse<{ user: ApiUser }>(response);
  return data.user;
}

/**
 * Lists all trips that the current user can access.
 */
export async function fetchTrips(): Promise<ApiTrip[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ trips: ApiTrip[] }>(response);
  return data.trips;
}

/**
 * Creates a new trip workspace and makes the current user its owner.
 */
export async function createTrip(payload: { title: string; currency?: CurrencyCode }): Promise<ApiTrip> {
  const response = await authedFetch(`${apiBaseUrl}/trips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currency: "VND",
      ...payload,
    }),
  });
  const data = await parseApiResponse<{ trip: ApiTrip }>(response);
  return data.trip;
}

/**
 * Changes a trip lifecycle state: active, completed, or archived.
 */
export async function updateTripStatus(targetTripId: string, status: ApiTripStatus): Promise<ApiTrip> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  const data = await parseApiResponse<{ trip: ApiTrip }>(response);
  return data.trip;
}

/**
 * Deletes a trip workspace on the backend.
 * Only the backend decides whether the current user has permission.
 */
export async function deleteTrip(targetTripId: string): Promise<void> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}`, {
    method: "DELETE",
  });

  if (response.status === 204) {
    return;
  }

  await parseApiResponse(response);
}

/**
 * Loads all expenses for a trip, newest first.
 */
export async function fetchExpenses(targetTripId = defaultTripId): Promise<ApiExpense[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/expenses`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ expenses: ApiExpense[] }>(response);
  return data.expenses;
}

/**
 * Loads members and profile fields for a trip.
 */
export async function fetchTripMembers(targetTripId = defaultTripId): Promise<ApiTripMember[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/members`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ members: ApiTripMember[] }>(response);
  return data.members;
}

/**
 * Loads active shared GPS locations for trip members.
 */
export async function fetchTripLocations(targetTripId = defaultTripId): Promise<ApiMemberLocation[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/locations`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ locations: ApiMemberLocation[] }>(response);
  return data.locations;
}

/**
 * Reverse-geocodes a member's latest shared GPS point into a readable address.
 */
export async function fetchMemberLocationAddress(memberId: string, targetTripId = defaultTripId): Promise<ApiMemberLocationAddress> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/locations/${memberId}/address`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ address: ApiMemberLocationAddress }>(response);
  return data.address;
}

/**
 * Loads shared map markers such as meetup points, warnings, food, lodging, or fuel.
 */
export async function fetchTripMapMarkers(targetTripId = defaultTripId): Promise<ApiMapMarker[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/map-markers`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ markers: ApiMapMarker[] }>(response);
  return data.markers;
}

/**
 * Loads nearby POIs along the current route.
 */
export async function fetchTripPois(targetTripId = defaultTripId, types: ApiTripPoiKind[] = ["food", "lodging", "fuel"]): Promise<ApiTripPoi[]> {
  const params = new URLSearchParams();
  params.set("types", types.join(","));
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/pois?${params.toString()}`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ pois: ApiTripPoi[] }>(response);
  return data.pois;
}

/**
 * Creates a shared marker on the trip map.
 */
export async function createTripMapMarker(
  payload: {
    label: string;
    kind: ApiMapMarkerKind;
    latitude: number;
    longitude: number;
  },
  targetTripId = defaultTripId,
): Promise<ApiMapMarker> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/map-markers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseApiResponse<{ marker: ApiMapMarker }>(response);
  return data.marker;
}

/**
 * Deletes a shared map marker from the selected trip.
 */
export async function deleteTripMapMarker(markerId: string, targetTripId = defaultTripId): Promise<void> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/map-markers/${markerId}`, {
    method: "DELETE",
  });

  if (response.status === 204) {
    return;
  }

  await parseApiResponse(response);
}

/**
 * Loads lightweight online/presence information for members in the room.
 */
export async function fetchTripPresence(targetTripId = defaultTripId): Promise<ApiPresenceUser[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/presence`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ presence: ApiPresenceUser[] }>(response);
  return data.presence;
}

/**
 * Loads recent trip chat messages.
 */
export async function fetchTripMessages(targetTripId = defaultTripId): Promise<ApiTripMessage[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/messages`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ messages: ApiTripMessage[] }>(response);
  return data.messages;
}

/**
 * Sends a chat message to the selected trip room.
 */
export async function sendTripMessage(body: string, targetTripId = defaultTripId): Promise<ApiTripMessage> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  const data = await parseApiResponse<{ message: ApiTripMessage }>(response);
  return data.message;
}

/**
 * Loads the latest saved route plan for a trip.
 */
export async function fetchRoutePlan(targetTripId = defaultTripId): Promise<ApiRoutePlan> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/route-plan`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ routePlan: ApiRoutePlan }>(response);
  return data.routePlan;
}

/**
 * Requests a new route plan from the backend.
 * Labels are used for display, while optional coordinates improve routing accuracy.
 */
export async function planRoute(
  payload: {
    origin: string;
    destination: string;
    originCoordinate?: ApiGeoPoint;
    destinationCoordinate?: ApiGeoPoint;
  },
  targetTripId = defaultTripId,
): Promise<ApiRoutePlan> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/route-plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseApiResponse<{ routePlan: ApiRoutePlan }>(response);
  return data.routePlan;
}

/**
 * Loads personal route layers created by trip members.
 */
export async function fetchMemberRoutes(targetTripId = defaultTripId): Promise<ApiMemberRoute[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/member-routes`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ memberRoutes: ApiMemberRoute[] }>(response);
  return data.memberRoutes;
}

/**
 * Creates or replaces the current user's personal route layer.
 */
export async function createMemberRoute(
  payload: {
    origin: string;
    destination: string;
    originCoordinate?: ApiGeoPoint;
    destinationCoordinate?: ApiGeoPoint;
  },
  targetTripId = defaultTripId,
): Promise<ApiMemberRoute> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/member-routes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseApiResponse<{ memberRoute: ApiMemberRoute }>(response);
  return data.memberRoute;
}

/**
 * Deletes a member route layer.
 */
export async function deleteMemberRoute(routeId: string, targetTripId = defaultTripId): Promise<void> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/member-routes/${routeId}`, {
    method: "DELETE",
  });

  if (response.status === 204) {
    return;
  }

  await parseApiResponse(response);
}

/**
 * Sends the current user's latest GPS point to the trip.
 */
export async function shareMyLocation(
  payload: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number | null;
    speedMps?: number | null;
    headingDegrees?: number | null;
  },
  targetTripId = defaultTripId,
): Promise<ApiMemberLocation> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/locations/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseApiResponse<{ location: ApiMemberLocation }>(response);
  return data.location;
}

/**
 * Stops sharing the current user's GPS location for the trip.
 */
export async function stopSharingMyLocation(targetTripId = defaultTripId): Promise<void> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/locations/me`, {
    method: "DELETE",
  });

  if (response.status === 204) {
    return;
  }

  await parseApiResponse(response);
}

/**
 * Invites/adds a member to the trip by email or display name.
 */
export async function addTripMember(payload: { displayName?: string; email?: string; role: ApiTripRole }, targetTripId = defaultTripId): Promise<ApiTripMember> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseApiResponse<{ member: ApiTripMember }>(response);
  return data.member;
}

/**
 * Updates a member's role or profile fields.
 */
export async function updateTripMember(
  memberId: string,
  payload: {
    displayName?: string;
    role?: ApiTripRole;
    phoneNumber?: string | null;
    homeBase?: string | null;
    travelStatus?: ApiTripMemberTravelStatus;
    statusEmoji?: string;
    avatarColor?: ApiTripMemberAvatarColor;
    backgroundKey?: ApiTripMemberBackgroundKey;
  },
  targetTripId = defaultTripId,
): Promise<ApiTripMember> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/members/${memberId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseApiResponse<{ member: ApiTripMember }>(response);
  return data.member;
}

/**
 * Removes a member from the active trip room.
 */
export async function removeTripMember(memberId: string, targetTripId = defaultTripId): Promise<void> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/members/${memberId}`, {
    method: "DELETE",
  });

  if (response.status === 204) {
    return;
  }

  await parseApiResponse(response);
}

/**
 * Loads split-bill balances and the "who pays whom" settlement list.
 */
export async function fetchSettlementResult(targetTripId = defaultTripId): Promise<{
  balances: ApiBalance[];
  settlements: ApiSettlement[];
}> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/settlements`, {
    cache: "no-store",
  });
  return parseApiResponse(response);
}

/**
 * Creates an expense in the selected trip.
 */
export async function createExpense(payload: ApiCreateExpensePayload, targetTripId = defaultTripId): Promise<ApiExpense> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/expenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseApiResponse<{ expense: ApiExpense }>(response);
  return data.expense;
}

/**
 * Subscribes to live trip events over Server-Sent Events and returns an unsubscribe function.
 */
export function subscribeToTripEvents(
  targetTripId: string,
  handlers: {
    onEvent(event: ApiTripLiveEvent): void;
    onOpen?(): void;
    onError?(): void;
  },
): () => void {
  // Live sync uses AbortController so old SSE connections are closed when the user switches trip,
  // logs out, or the component unmounts. Without this, the browser can keep duplicate event streams alive.
  const controller = new AbortController();

  void listenToTripEvents(targetTripId, controller.signal, handlers);

  return () => {
    controller.abort();
  };
}

/**
 * Fetch wrapper that attaches the current Firebase ID token to protected backend requests.
 */
async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getFirebaseIdToken();

  // Security note:
  // - The Firebase ID token is read in memory only when a request is sent.
  // - We do not manually store bearer tokens in localStorage/sessionStorage, reducing XSS token theft risk.
  // - The backend verifies this bearer token on every protected request.
  return fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      // Security: the ID token is attached in memory per request. We never manually persist this bearer token in localStorage.
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * Opens and maintains the SSE connection for one trip.
 */
async function listenToTripEvents(
  targetTripId: string,
  signal: AbortSignal,
  handlers: {
    onEvent(event: ApiTripLiveEvent): void;
    onOpen?(): void;
    onError?(): void;
  },
) {
  // SSE is the lightweight live channel for trip changes.
  // If the network drops or the free backend wakes slowly, the loop waits 3 seconds and reconnects automatically.
  while (!signal.aborted) {
    try {
      const token = await getFirebaseIdToken();
      const response = await fetch(`${apiBaseUrl}/trips/${targetTripId}/events`, {
        cache: "no-store",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error("Live sync connection failed");
      }

      handlers.onOpen?.();
      await readSseStream(response.body, signal, handlers.onEvent);
    } catch {
      if (signal.aborted) {
        return;
      }

      handlers.onError?.();
      await delay(3000, signal);
    }
  }
}

/**
 * Reads raw SSE bytes and emits parsed trip events.
 */
async function readSseStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, onEvent: (event: ApiTripLiveEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // SSE arrives as arbitrary byte chunks, so one read is not always one full event.
    // The buffer keeps partial chunks until a blank line marks the end of an SSE event.
    while (!signal.aborted) {
      const { done, value } = await reader.read();

      if (done) {
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const event = parseSseEvent(chunk);

        if (event) {
          onEvent(event);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parses one SSE chunk into a typed trip event.
 */
function parseSseEvent(chunk: string): ApiTripLiveEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (eventName !== "trip_changed" || !dataLines.length) {
    return null;
  }

  try {
    const data = JSON.parse(dataLines.join("\n")) as ApiTripLiveEvent;
    return typeof data.id === "string" && typeof data.tripId === "string" ? data : null;
  } catch {
    return null;
  }
}

/**
 * Waits for a reconnect delay, but resolves early if the SSE connection is aborted.
 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Returns the current Firebase ID token or throws if the user is not signed in.
 */
async function getFirebaseIdToken(): Promise<string> {
  const user = await getCurrentFirebaseUser();

  if (!user) {
    throw new Error("You must sign in first");
  }

  return user.getIdToken();
}

/**
 * Converts a backend Response into typed data or throws a readable API error.
 */
async function parseApiResponse<T>(response: Response): Promise<T> {
  // The backend normally returns JSON with a message on errors.
  // If a response is not JSON, this still throws a friendly error instead of crashing the UI.
  const data = (await response.json().catch(() => null)) as T | { message?: string } | null;

  if (!response.ok) {
    throw new Error(readApiErrorMessage(data) || "API request failed");
  }

  return data as T;
}

/**
 * Extracts a backend error message from a response body.
 */
function readApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("message" in data)) {
    return null;
  }

  const message = (data as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
