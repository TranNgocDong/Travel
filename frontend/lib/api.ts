import { GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from "firebase/auth";

import { getFirebaseAuth } from "./firebase";
import type { CurrencyCode } from "./settlements";

export const defaultTripId = process.env.NEXT_PUBLIC_DEFAULT_TRIP_ID ?? "";
export const tripId = defaultTripId;

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? (process.env.NODE_ENV === "production" ? "https://travel-4bm4.onrender.com/api/v1" : "http://localhost:4000/api/v1");
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

let currentFirebaseUser: User | null = null;
let authReadyPromise: Promise<User | null> | null = null;

export type ApiParticipant = {
  id: string;
  displayName?: string;
};

export type ApiTripRole = "owner" | "editor" | "viewer";

export type ApiTripMember = {
  userId: string;
  displayName: string;
  role: ApiTripRole;
};

export type ApiTrip = {
  id: string;
  title: string;
  currency: CurrencyCode;
  role: ApiTripRole;
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
    | "message_created"
    | "location_updated"
    | "location_stopped"
    | "presence_joined"
    | "presence_left";
  actorUserId: string;
  actorDisplayName?: string;
  createdAt: string;
};

export async function getCurrentFirebaseUser(): Promise<User | null> {
  const firebaseAuth = getFirebaseAuth();

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

export async function login(email: string, password: string): Promise<ApiUser> {
  await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  return fetchMe();
}

export async function loginWithGoogle(): Promise<ApiUser> {
  await signInWithPopup(getFirebaseAuth(), googleProvider);
  return fetchMe();
}

export async function logout(): Promise<void> {
  await signOut(getFirebaseAuth());
  currentFirebaseUser = null;
  authReadyPromise = null;
}

export async function fetchMe(): Promise<ApiUser> {
  const response = await authedFetch(`${apiBaseUrl}/me`);
  const data = await parseApiResponse<{ user: ApiUser }>(response);
  return data.user;
}

export async function fetchTrips(): Promise<ApiTrip[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ trips: ApiTrip[] }>(response);
  return data.trips;
}

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

export async function fetchExpenses(targetTripId = defaultTripId): Promise<ApiExpense[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/expenses`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ expenses: ApiExpense[] }>(response);
  return data.expenses;
}

export async function fetchTripMembers(targetTripId = defaultTripId): Promise<ApiTripMember[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/members`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ members: ApiTripMember[] }>(response);
  return data.members;
}

export async function fetchTripLocations(targetTripId = defaultTripId): Promise<ApiMemberLocation[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/locations`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ locations: ApiMemberLocation[] }>(response);
  return data.locations;
}

export async function fetchTripPresence(targetTripId = defaultTripId): Promise<ApiPresenceUser[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/presence`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ presence: ApiPresenceUser[] }>(response);
  return data.presence;
}

export async function fetchTripMessages(targetTripId = defaultTripId): Promise<ApiTripMessage[]> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/messages`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ messages: ApiTripMessage[] }>(response);
  return data.messages;
}

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

export async function fetchRoutePlan(targetTripId = defaultTripId): Promise<ApiRoutePlan> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/route-plan`, {
    cache: "no-store",
  });
  const data = await parseApiResponse<{ routePlan: ApiRoutePlan }>(response);
  return data.routePlan;
}

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

export async function stopSharingMyLocation(targetTripId = defaultTripId): Promise<void> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/locations/me`, {
    method: "DELETE",
  });

  if (response.status === 204) {
    return;
  }

  await parseApiResponse(response);
}

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

export async function updateTripMember(memberId: string, payload: { displayName?: string; role?: ApiTripRole }, targetTripId = defaultTripId): Promise<ApiTripMember> {
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

export async function removeTripMember(memberId: string, targetTripId = defaultTripId): Promise<void> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/members/${memberId}`, {
    method: "DELETE",
  });

  if (response.status === 204) {
    return;
  }

  await parseApiResponse(response);
}

export async function fetchSettlementResult(targetTripId = defaultTripId): Promise<{
  balances: ApiBalance[];
  settlements: ApiSettlement[];
}> {
  const response = await authedFetch(`${apiBaseUrl}/trips/${targetTripId}/settlements`, {
    cache: "no-store",
  });
  return parseApiResponse(response);
}

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

export function subscribeToTripEvents(
  targetTripId: string,
  handlers: {
    onEvent(event: ApiTripLiveEvent): void;
    onOpen?(): void;
    onError?(): void;
  },
): () => void {
  const controller = new AbortController();

  void listenToTripEvents(targetTripId, controller.signal, handlers);

  return () => {
    controller.abort();
  };
}

async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getFirebaseIdToken();

  return fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      Authorization: `Bearer ${token}`,
    },
  });
}

async function listenToTripEvents(
  targetTripId: string,
  signal: AbortSignal,
  handlers: {
    onEvent(event: ApiTripLiveEvent): void;
    onOpen?(): void;
    onError?(): void;
  },
) {
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

async function readSseStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, onEvent: (event: ApiTripLiveEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
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

async function getFirebaseIdToken(): Promise<string> {
  const user = await getCurrentFirebaseUser();

  if (!user) {
    throw new Error("You must sign in first");
  }

  return user.getIdToken();
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as T | { message?: string } | null;

  if (!response.ok) {
    throw new Error(readApiErrorMessage(data) || "API request failed");
  }

  return data as T;
}

function readApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("message" in data)) {
    return null;
  }

  const message = (data as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
