import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

import { InMemoryTripAuditRepository, PostgresTripAuditRepository, type TripAuditAction, type TripAuditRepository } from "./audit/tripAuditRepository.js";
import { verifyFirebaseBearerToken } from "./auth/firebaseAuth.js";
import { toSafeUser, type UserAccount } from "./auth/types.js";
import { displayNameFromEmail, isValidEmail, normalizeEmail, userIdFromEmail } from "./auth/userIdentity.js";
import { InMemoryTripMessageRepository, PostgresTripMessageRepository, type TripMessageRepository } from "./chat/tripMessageRepository.js";
import { createPool, getDatabaseUrl, pingDatabase } from "./db/config.js";
import { defaultFxRates, supportedCurrencies } from "./expense/referenceData.js";
import { DuplicateExpenseIdError, InMemoryExpenseRepository, type ExpenseRepository, type StoredExpense } from "./expense/expenseRepository.js";
import { PostgresExpenseRepository } from "./expense/postgresExpenseRepository.js";
import { calculateSplitBill, SplitBillError, type CurrencyCode, type ExpenseSplit } from "./expense/splitBill.js";
import { LiveSyncHub, type LiveSyncEventType } from "./liveSync/liveSyncHub.js";
import {
  InMemoryTripMemberLocationRepository,
  PostgresTripMemberLocationRepository,
  type TripMemberLocationRepository,
} from "./locations/memberLocationRepository.js";
import {
  InMemoryTripMapMarkerRepository,
  PostgresTripMapMarkerRepository,
  type TripMapMarkerKind,
  type TripMapMarkerRepository,
} from "./mapMarkers/tripMapMarkerRepository.js";
import { findOpenStreetMapPoisForRoute, type TripPoiKind } from "./poi/openStreetMapPoi.js";
import { InMemoryMemberRouteRepository, PostgresMemberRouteRepository, type MemberRouteRepository } from "./route/memberRouteRepository.js";
import { InMemoryRoutePlanRepository, PostgresRoutePlanRepository, type RoutePlanRepository } from "./route/routePlanRepository.js";
import { buildOpenStreetRoutePlan, buildStarterRoutePlan, reverseGeocodePoint, RoutePlannerError } from "./route/routePlanner.js";
import { canManageMembers, canWriteTrip, TripAccessService, type TripRole } from "./trips/tripAccess.js";
import { InMemoryTripRepository, PostgresTripRepository, type TripRepository, type TripStatus } from "./trips/tripRepository.js";
import {
  InMemoryTripMemberRepository,
  PostgresTripMemberRepository,
  type TripMember,
  type TripMemberAvatarColor,
  type TripMemberBackgroundKey,
  type TripMemberPatch,
  type TripMemberRepository,
  type TripMemberTravelStatus,
} from "./trips/tripMemberRepository.js";

const databaseUrl = getDatabaseUrl();
const isProduction = process.env.NODE_ENV === "production";

// Production must never start with in-memory storage.
// In-memory repositories are convenient for local development, but they would lose trips, GPS, chat, and expenses on restart.
if (isProduction && !databaseUrl) {
  throw new Error("DATABASE_URL is required when NODE_ENV=production. Refusing to start with in-memory local data.");
}

// Repository selection is centralized here so the rest of the server can use the same interfaces
// whether it is backed by Postgres in production or memory during local/offline development.
const pool = databaseUrl ? createPool() : null;
const repository: ExpenseRepository = pool ? new PostgresExpenseRepository(pool) : new InMemoryExpenseRepository();
const memberRepository: TripMemberRepository = pool ? new PostgresTripMemberRepository(pool) : new InMemoryTripMemberRepository();
const messageRepository: TripMessageRepository = pool ? new PostgresTripMessageRepository(pool) : new InMemoryTripMessageRepository();
const mapMarkerRepository: TripMapMarkerRepository = pool ? new PostgresTripMapMarkerRepository(pool) : new InMemoryTripMapMarkerRepository();
const locationRepository: TripMemberLocationRepository = pool
  ? new PostgresTripMemberLocationRepository(pool)
  : new InMemoryTripMemberLocationRepository();
const routePlanRepository: RoutePlanRepository = pool ? new PostgresRoutePlanRepository(pool) : new InMemoryRoutePlanRepository();
const memberRouteRepository: MemberRouteRepository = pool ? new PostgresMemberRouteRepository(pool) : new InMemoryMemberRouteRepository();
const auditRepository: TripAuditRepository = pool ? new PostgresTripAuditRepository(pool) : new InMemoryTripAuditRepository();
const tripRepository: TripRepository = pool ? new PostgresTripRepository(pool) : new InMemoryTripRepository();
const tripAccess = new TripAccessService(memberRepository);
const storageMode = pool ? "postgres" : "memory";
const liveSyncHub = new LiveSyncHub();

const app = Fastify({
  logger: true,
});

await app.register(helmet, {
  contentSecurityPolicy: false,
});

await app.register(cors, {
  // CORS origins are parsed from env so production can allow only the deployed frontend domains.
  // This is still paired with Firebase bearer token checks; CORS alone is not authentication.
  origin: parseCorsOrigins(process.env.CORS_ORIGINS),
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

await app.register(rateLimit, {
  // Basic API-level abuse protection. Authentication-specific limits should stay stricter
  // at Firebase/identity provider level, but this protects public HTTP resources too.
  max: 120,
  timeWindow: "1 minute",
});

app.addHook("onClose", async () => {
  await pool?.end();
});

app.get("/health", async () => {
  return {
    ok: true,
    service: "travel-tech-backend",
    storage: storageMode,
    database: pool ? "configured" : "not_configured",
  };
});

app.get("/ready", async (_request, reply) => {
  // /ready checks whether the database is actually reachable.
  // Render/Railway health checks should prefer this when a successful DB connection is required.
  if (pool) {
    try {
      await pingDatabase(pool);
    } catch {
      return reply.status(503).send({
        ok: false,
        service: "travel-tech-backend",
        storage: storageMode,
        database: "down",
      });
    }
  }

  return {
    ok: true,
    service: "travel-tech-backend",
    storage: storageMode,
    database: pool ? "up" : "not_configured",
  };
});

app.get("/api/v1/me", async (request, reply) => {
  const user = await requireAuth(request, reply);

  if (!user) {
    return;
  }

  return {
    user: toSafeUser(user),
  };
});

app.get("/api/v1/trips", async (request, reply) => {
  const user = await requireAuth(request, reply);

  if (!user) {
    return;
  }

  return {
    trips: await tripRepository.listForUser(user.id),
  };
});

app.post("/api/v1/trips", async (request, reply) => {
  const user = await requireAuth(request, reply);

  if (!user) {
    return;
  }

  const parsed = parseCreateTripBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  const trip = await tripRepository.create({
    id: createTripId(parsed.title),
    title: parsed.title,
    currency: parsed.currency,
  });

  // The creator becomes the first owner immediately.
  // Both the member table and the trip-user link are updated so RBAC and trip lists stay consistent.
  await memberRepository.add(trip.id, {
    userId: user.id,
    displayName: user.displayName,
    role: "owner",
    active: true,
    removedAt: null,
    ...defaultMemberProfile(),
  });
  await tripRepository.linkUser(trip.id, user.id, "owner");
  await recordAuditEvent({
    tripId: trip.id,
    actor: user,
    action: "trip_created",
    resourceId: trip.id,
    metadata: {
      currency: trip.currency,
    },
  });

  return reply.status(201).send({
    trip: {
      ...trip,
      role: "owner",
    },
  });
});

app.patch("/api/v1/trips/:tripId/status", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  // Completing, archiving, or reopening a trip changes the shared workspace,
  // so only managers/owners are allowed to do it.
  if (!user || !(await requireTripRole(reply, tripId, user.id, "manage"))) {
    return;
  }

  const parsed = parseTripStatusBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  const trip = await tripRepository.updateStatus(tripId, parsed.status);

  if (!trip) {
    return reply.status(404).send({
      error: "TRIP_NOT_FOUND",
      message: "Không tìm thấy chuyến đi",
    });
  }

  publishTripChange(tripId, user.id, "trip_changed", user.displayName);
  await recordAuditEvent({
    tripId,
    actor: user,
    action: "trip_status_changed",
    resourceId: tripId,
    metadata: {
      status: parsed.status,
    },
  });

  return {
    trip: {
      ...trip,
      role: "owner" satisfies TripRole,
    },
  };
});

app.delete("/api/v1/trips/:tripId", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "manage"))) {
    return;
  }

  await recordAuditEvent({
    tripId,
    actor: user,
    action: "trip_deleted",
    resourceId: tripId,
  });
  await tripRepository.delete(tripId);
  publishTripChange(tripId, user.id, "trip_deleted", user.displayName);

  return reply.status(204).send();
});

app.get("/api/v1/trips/:tripId/audit-events", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "manage"))) {
    return;
  }

  return {
    events: await auditRepository.listByTrip(tripId, parseAuditLimit(request.query)),
  };
});

app.get("/api/v1/trips/:tripId/bootstrap", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const trip = await tripRepository.findById(tripId);

  return {
    trip: {
      id: tripId,
      title: trip?.title ?? "Trip",
      currency: trip?.currency ?? "VND",
    },
    participants: toSplitParticipants(await memberRepository.listByTrip(tripId)),
    currencies: supportedCurrencies,
    fxRates: defaultFxRates,
  };
});

app.get("/api/v1/trips/:tripId/route-plan", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const savedRoutePlan = await routePlanRepository.findByTrip(tripId);

  return {
    routePlan: savedRoutePlan ?? buildStarterRoutePlan(tripId),
  };
});

app.get("/api/v1/trips/:tripId/pois", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const routePlan = (await routePlanRepository.findByTrip(tripId)) ?? buildStarterRoutePlan(tripId);

  try {
    return {
      pois: await findOpenStreetMapPoisForRoute(routePlan, parsePoiQuery(request.query)),
    };
  } catch {
    return {
      pois: [],
      warning: "Không lấy được địa điểm từ OpenStreetMap lúc này",
    };
  }
});

app.get("/api/v1/trips/:tripId/events", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const clientId = randomUUID();
  const wasUserOnline = liveSyncHub.hasUser(tripId, user.id);
  reply.hijack();
  reply.raw.writeHead(200, buildLiveSyncHeaders(request.headers.origin));
  reply.raw.write(`event: ready\ndata: ${JSON.stringify({ clientId, tripId })}\n\n`);

  const removeClient = liveSyncHub.add({
    id: clientId,
    tripId,
    userId: user.id,
    displayName: user.displayName,
    connectedAt: new Date().toISOString(),
    send: (event) => {
      reply.raw.write(`id: ${event.id}\nevent: trip_changed\ndata: ${JSON.stringify(event)}\n\n`);
    },
  });

  if (!wasUserOnline) {
    publishTripChange(tripId, user.id, "presence_joined", user.displayName);
  }

  const heartbeat = setInterval(() => {
    reply.raw.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  }, 25_000);

  request.raw.on("close", () => {
    clearInterval(heartbeat);
    removeClient();

    if (!liveSyncHub.hasUser(tripId, user.id)) {
      publishTripChange(tripId, user.id, "presence_left", user.displayName);
    }
  });
});

app.get("/api/v1/trips/:tripId/presence", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  return {
    presence: liveSyncHub.listPresence(tripId),
  };
});

app.get("/api/v1/trips/:tripId/messages", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  return {
    messages: await messageRepository.listByTrip(tripId, parseMessageLimit(request.query)),
  };
});

app.post("/api/v1/trips/:tripId/messages", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const parsed = parseMessageBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  const message = await messageRepository.create({
    id: `msg_${randomUUID()}`,
    tripId,
    userId: user.id,
    displayName: user.displayName,
    body: parsed.body,
  });
  publishTripChange(tripId, user.id, "message_created", user.displayName);

  return reply.status(201).send({
    message,
  });
});

app.post("/api/v1/trips/:tripId/route-plan", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "write"))) {
    return;
  }

  const parsed = parseRoutePlanBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  try {
    const routePlan = await buildOpenStreetRoutePlan(tripId, parsed.input);
    const savedRoutePlan = await routePlanRepository.save(tripId, user.id, routePlan);
    publishTripChange(tripId, user.id, "route_plan_updated");
    await recordAuditEvent({
      tripId,
      actor: user,
      action: "route_plan_updated",
      resourceId: tripId,
      metadata: {
        destination: savedRoutePlan.destination,
        distanceKm: savedRoutePlan.totalDistanceKm,
      },
    });

    return {
      routePlan: savedRoutePlan,
    };
  } catch (error) {
    return sendRoutePlannerError(reply, error);
  }
});

app.get("/api/v1/trips/:tripId/member-routes", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  return {
    memberRoutes: await memberRouteRepository.listByTrip(tripId),
  };
});

app.post("/api/v1/trips/:tripId/member-routes", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const parsed = parseRoutePlanBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  try {
    const routePlan = await buildOpenStreetRoutePlan(tripId, parsed.input);
    const memberRoute = await memberRouteRepository.save({
      id: `member_route_${randomUUID()}`,
      tripId,
      userId: user.id,
      displayName: user.displayName,
      routePlan: {
        ...routePlan,
        title: `Tuyến của ${user.displayName}`,
      },
    });
    publishTripChange(tripId, user.id, "member_route_changed", user.displayName);
    await recordAuditEvent({
      tripId,
      actor: user,
      action: "member_route_saved",
      resourceId: memberRoute.id,
      metadata: {
        destination: memberRoute.routePlan.destination,
        distanceKm: memberRoute.routePlan.totalDistanceKm,
      },
    });

    return reply.status(201).send({
      memberRoute,
    });
  } catch (error) {
    return sendRoutePlannerError(reply, error);
  }
});

app.delete("/api/v1/trips/:tripId/member-routes/:routeId", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);
  const routeId = parseRouteIdParam(request.params);

  if (!tripId || !routeId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const route = await memberRouteRepository.findById(tripId, routeId);

  if (!route) {
    return reply.status(404).send({
      error: "NOT_FOUND",
      message: "Không tìm thấy tuyến riêng",
    });
  }

  const role = await tripAccess.getRole(tripId, user.id);

  if (route.userId !== user.id && role !== "owner") {
    return reply.status(403).send({
      error: "FORBIDDEN",
      message: "Bạn không thể xóa tuyến riêng của người khác",
    });
  }

  await memberRouteRepository.remove(tripId, routeId);
  publishTripChange(tripId, user.id, "member_route_changed", user.displayName);
  await recordAuditEvent({
    tripId,
    actor: user,
    action: "member_route_deleted",
    targetUserId: route.userId,
    resourceId: routeId,
  });

  return reply.status(204).send();
});

app.get("/api/v1/trips/:tripId/map-markers", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  return {
    markers: await mapMarkerRepository.listByTrip(tripId),
  };
});

app.post("/api/v1/trips/:tripId/map-markers", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const parsed = parseMapMarkerBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  const marker = await mapMarkerRepository.create({
    id: `marker_${randomUUID()}`,
    tripId,
    userId: user.id,
    displayName: user.displayName,
    ...parsed.marker,
  });
  publishTripChange(tripId, user.id, "map_marker_changed", user.displayName);
  await recordAuditEvent({
    tripId,
    actor: user,
    action: "map_marker_created",
    resourceId: marker.id,
    metadata: {
      kind: marker.kind,
    },
  });

  return reply.status(201).send({
    marker,
  });
});

app.delete("/api/v1/trips/:tripId/map-markers/:markerId", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);
  const markerId = parseMarkerId(request.params);

  if (!tripId) {
    return;
  }

  if (!markerId) {
    return reply.status(400).send({
      error: "INVALID_MARKER",
      message: "Marker id is required",
    });
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const marker = await mapMarkerRepository.findById(tripId, markerId);

  if (!marker) {
    return reply.status(404).send({
      error: "MARKER_NOT_FOUND",
      message: "Không tìm thấy điểm đánh dấu",
    });
  }

  const role = await tripAccess.getRole(tripId, user.id);

  if (marker.userId !== user.id && (!role || !canManageMembers(role))) {
    return reply.status(403).send({
      error: "FORBIDDEN",
      message: "Bạn chỉ có thể xóa điểm do mình tạo",
    });
  }

  await mapMarkerRepository.remove(tripId, markerId);
  publishTripChange(tripId, user.id, "map_marker_changed", user.displayName);
  await recordAuditEvent({
    tripId,
    actor: user,
    action: "map_marker_deleted",
    targetUserId: marker.userId,
    resourceId: markerId,
    metadata: {
      kind: marker.kind,
    },
  });

  return reply.status(204).send();
});

app.get("/api/v1/trips/:tripId/members", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  return {
    members: await memberRepository.listByTrip(tripId),
  };
});

app.get("/api/v1/trips/:tripId/locations", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  // GPS points are short-lived. Pruning before reads prevents stale member pins
  // from appearing as if someone is still sharing live location.
  await locationRepository.pruneExpired();

  return {
    locations: await locationRepository.listActiveByTrip(tripId),
  };
});

app.get("/api/v1/trips/:tripId/locations/:memberId/address", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);
  const memberId = parseMemberId(request.params);

  if (!tripId) {
    return;
  }

  if (!memberId) {
    return reply.status(400).send({
      error: "INVALID_MEMBER",
      message: "Member id is required",
    });
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  await locationRepository.pruneExpired();
  const location = (await locationRepository.listActiveByTrip(tripId)).find((item) => item.userId === memberId);

  if (!location) {
    return reply.status(404).send({
      error: "LOCATION_NOT_FOUND",
      message: "Thành viên này chưa bật chia sẻ GPS",
    });
  }

  try {
    const address = await reverseGeocodePoint({
      lat: location.latitude,
      lng: location.longitude,
    });

    return {
      address: {
        userId: memberId,
        displayName: location.displayName,
        label: address.label,
        address: address.address,
        latitude: location.latitude,
        longitude: location.longitude,
        resolvedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return sendRoutePlannerError(reply, error);
  }
});

app.put("/api/v1/trips/:tripId/locations/me", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  const parsed = parseLocationBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  // A member may only update their own live GPS point.
  // The user id always comes from the verified Firebase token, never from the request body.
  const location = await locationRepository.upsert({
    tripId,
    userId: user.id,
    ...parsed.location,
  });
  publishTripChange(tripId, user.id, "location_updated");

  return {
    location: {
      ...location,
      displayName: user.displayName,
    },
  };
});

app.delete("/api/v1/trips/:tripId/locations/me", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  await locationRepository.remove(tripId, user.id);
  publishTripChange(tripId, user.id, "location_stopped");

  return reply.status(204).send();
});

app.post("/api/v1/trips/:tripId/members", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  // Adding members is a room-management action, so it requires owner/manage access.
  if (!user || !(await requireTripRole(reply, tripId, user.id, "manage"))) {
    return;
  }

  const parsed = parseMemberBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  const member: TripMember = {
    userId: parsed.userId,
    displayName: parsed.displayName,
    role: parsed.role ?? "viewer",
    active: true,
    removedAt: null,
    ...defaultMemberProfile(),
  };

  try {
    const addedMember = await memberRepository.add(tripId, member);
    await tripRepository.linkUser(tripId, addedMember.userId, addedMember.role);
    publishTripChange(tripId, user.id, "member_changed");
    await recordAuditEvent({
      tripId,
      actor: user,
      action: "member_added",
      targetUserId: addedMember.userId,
      metadata: {
        role: addedMember.role,
      },
    });

    return reply.status(201).send({
      member: addedMember,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_MEMBER") {
      return reply.status(409).send({
        error: "DUPLICATE_MEMBER",
        message: "Member already exists in this trip",
      });
    }

    throw error;
  }
});

app.patch("/api/v1/trips/:tripId/members/:memberId", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);
  const memberId = parseMemberId(request.params);

  if (!tripId || !memberId) {
    return reply.status(400).send({
      error: "INVALID_MEMBER",
      message: "Member id is required",
    });
  }

  const user = await requireAuth(request, reply);

  if (!user) {
    return;
  }

  const requesterRole = await tripAccess.getRole(tripId, user.id);
  const canManage = canManageMembers(requesterRole);
  const isSelfUpdate = memberId === user.id;

  // Owners can edit any member. Regular members can only edit their own profile fields.
  // Role changes are blocked below unless the requester has manage permission.
  if (!requesterRole || (!canManage && !isSelfUpdate)) {
    return reply.status(403).send({
      error: "FORBIDDEN",
      message: "You do not have access to update this member",
    });
  }

  const parsed = parseMemberPatchBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  if (memberId === user.id && parsed.patch.role && parsed.patch.role !== "owner") {
    // Prevent the last active owner from accidentally removing their own management access.
    return reply.status(400).send({
      error: "OWNER_SELF_DOWNGRADE",
      message: "Owner cannot downgrade their own role",
    });
  }

  if (!canManage && parsed.patch.role) {
    // Self-service profile editing is allowed, but role escalation is never allowed from the client.
    return reply.status(403).send({
      error: "ROLE_UPDATE_FORBIDDEN",
      message: "Only the room owner can change member roles",
    });
  }

  const updated = await memberRepository.update(tripId, memberId, parsed.patch);

  if (!updated) {
    return reply.status(404).send({
      error: "MEMBER_NOT_FOUND",
      message: "Member was not found",
    });
  }

  await tripRepository.linkUser(tripId, updated.userId, updated.role);
  publishTripChange(tripId, user.id, "member_changed");

  if (parsed.patch.role) {
    await recordAuditEvent({
      tripId,
      actor: user,
      action: "member_role_changed",
      targetUserId: updated.userId,
      metadata: {
        role: updated.role,
      },
    });
  }

  return {
    member: updated,
  };
});

app.delete("/api/v1/trips/:tripId/members/:memberId", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);
  const memberId = parseMemberId(request.params);

  if (!tripId || !memberId) {
    return reply.status(400).send({
      error: "INVALID_MEMBER",
      message: "Member id is required",
    });
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "manage"))) {
    return;
  }

  if (memberId === user.id) {
    // Owners should leave/delete/archive the trip through dedicated flows instead of removing themselves here.
    return reply.status(400).send({
      error: "OWNER_SELF_REMOVE",
      message: "You cannot remove yourself from the trip",
    });
  }

  const members = await memberRepository.listByTrip(tripId);
  const activeOwners = members.filter((member) => member.active && member.role === "owner");
  const targetMember = members.find((member) => member.userId === memberId);

  if (!targetMember || !targetMember.active) {
    return reply.status(404).send({
      error: "MEMBER_NOT_FOUND",
      message: "Không tìm thấy thành viên trong phòng",
    });
  }

  if (targetMember.role === "owner" && activeOwners.length <= 1) {
    // Every active trip must keep at least one owner so the room is not orphaned.
    return reply.status(400).send({
      error: "LAST_OWNER_REMOVE",
      message: "Phòng phải còn ít nhất một chủ phòng",
    });
  }

  await memberRepository.remove(tripId, memberId);
  await locationRepository.remove(tripId, memberId);
  await tripRepository.unlinkUser(tripId, memberId);
  publishTripChange(tripId, user.id, "member_changed");
  await recordAuditEvent({
    tripId,
    actor: user,
    action: "member_removed",
    targetUserId: memberId,
    metadata: {
      role: targetMember.role,
    },
  });
  return reply.status(204).send();
});

app.get("/api/v1/trips/:tripId/expenses", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  return {
    expenses: await repository.listByTrip(tripId),
  };
});

app.post("/api/v1/trips/:tripId/expenses", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "write"))) {
    return;
  }

  const parsed = parseCreateExpenseBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  const expense: StoredExpense = {
    ...parsed.expense,
    id: parsed.clientMutationId ?? randomUUID(),
    createdAt: new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Saigon",
    }).format(new Date()),
  };

  const members = await memberRepository.listByTrip(tripId);
  const activeMembers = members.filter(isActiveTripMember);

  if (!isExpenseLimitedToMembers(expense, activeMembers)) {
    return reply.status(400).send({
      error: "INACTIVE_MEMBER_IN_EXPENSE",
      message: "Chỉ có thể ghi chi phí cho thành viên đang ở trong phòng",
    });
  }

  const nextExpenses = [expense, ...(await repository.listByTrip(tripId))];
  const participants = toSplitParticipants(members);

  try {
    calculateSplitBill({
      participants,
      currencies: supportedCurrencies,
      fxRates: defaultFxRates,
      tripCurrency: "VND",
      expenses: nextExpenses,
    });
  } catch (error) {
    return sendSplitBillError(reply, error);
  }

  try {
    const savedExpense = await repository.add(tripId, expense);
    publishTripChange(tripId, user.id, "expense_created");
    await recordAuditEvent({
      tripId,
      actor: user,
      action: "expense_created",
      resourceId: savedExpense.id,
      metadata: {
        currency: savedExpense.money.currency,
        category: savedExpense.category,
        participantCount: countExpenseParticipants(savedExpense.split),
      },
    });

    return reply.status(201).send({
      expense: savedExpense,
    });
  } catch (error) {
    if (error instanceof DuplicateExpenseIdError) {
      return reply.status(409).send({
        error: "DUPLICATE_EXPENSE_ID",
        message: "Expense id already exists",
      });
    }

    throw error;
  }
});

app.get("/api/v1/trips/:tripId/settlements", async (request, reply) => {
  const { tripId } = parseTripParams(request.params, reply);

  if (!tripId) {
    return;
  }

  const user = await requireAuth(request, reply);

  if (!user || !(await requireTripRole(reply, tripId, user.id, "read"))) {
    return;
  }

  try {
    return calculateSplitBill({
      participants: toSplitParticipants(await memberRepository.listByTrip(tripId)),
      currencies: supportedCurrencies,
      fxRates: defaultFxRates,
      tripCurrency: "VND",
      expenses: await repository.listByTrip(tripId),
    });
  } catch (error) {
    return sendSplitBillError(reply, error);
  }
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? (isProduction ? "0.0.0.0" : "127.0.0.1");

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

/**
 * Sends a lightweight live-sync notification to connected trip clients.
 */
function publishTripChange(tripId: string, actorUserId: string, type: LiveSyncEventType, actorDisplayName?: string) {
  liveSyncHub.publish({
    tripId,
    actorUserId,
    type,
    ...(actorDisplayName ? { actorDisplayName } : {}),
  });
}

/**
 * Records an auditable action for security/accountability history.
 */
async function recordAuditEvent(input: {
  tripId: string;
  actor: UserAccount;
  action: TripAuditAction;
  targetUserId?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    // Audit writes are best-effort: they are important for accountability,
    // but a logging failure should not block a user's main action.
    const auditInput = {
      id: `audit_${randomUUID()}`,
      tripId: input.tripId,
      actorUserId: input.actor.id,
      actorDisplayName: input.actor.displayName,
      action: input.action,
      metadata: scrubAuditMetadata(input.metadata ?? {}),
      ...(input.targetUserId !== undefined ? { targetUserId: input.targetUserId } : {}),
      ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
    };
    await auditRepository.create(auditInput);
  } catch (error) {
    app.log.warn({ error, tripId: input.tripId, action: input.action }, "Failed to write audit event");
  }
}

/**
 * Removes unsafe or oversized audit metadata before it is stored.
 */
function scrubAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safeMetadata: Record<string, unknown> = {};

  // Store only small primitive metadata values.
  // This prevents accidental logging of large objects, tokens, documents, or sensitive profile data.
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      safeMetadata[key] = value.slice(0, 160);
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      safeMetadata[key] = value;
    }
  }

  return safeMetadata;
}

/**
 * Authenticates a request using a Firebase bearer token.
 */
async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<UserAccount | null> {
  const authorization = request.headers.authorization;

  // All protected API routes require a Firebase ID token in the Authorization header.
  // The backend does not trust any user id sent from the browser body/query string.
  if (!authorization?.startsWith("Bearer ")) {
    reply.status(401).send({
      error: "MISSING_ACCESS_TOKEN",
      message: "Access token is required",
    });
    return null;
  }

  try {
    const user = await verifyFirebaseBearerToken(authorization.slice("Bearer ".length));

    // Disabled or unknown users are rejected even when the token format is valid.
    if (!user || user.status !== "active") {
      reply.status(401).send({
        error: "INVALID_USER",
        message: "User is not active",
      });
      return null;
    }

    return user;
  } catch {
    reply.status(401).send({
      error: "INVALID_ACCESS_TOKEN",
      message: "Access token is invalid or expired",
    });
    return null;
  }
}

/**
 * Enforces trip-level RBAC for read/write/manage actions.
 */
async function requireTripRole(reply: FastifyReply, tripId: string, userId: string, mode: "read" | "write" | "manage"): Promise<boolean> {
  const role = await tripAccess.getRole(tripId, userId);

  // Central RBAC gate:
  // read   = can see trip data.
  // write  = can modify trip content such as routes, markers, expenses.
  // manage = can change members, status, or delete/archive sensitive resources.
  if (!role || (mode === "write" && !canWriteTrip(role)) || (mode === "manage" && !canManageMembers(role))) {
    reply.status(403).send({
      error: "FORBIDDEN",
      message: "You do not have access to this trip",
    });
    return false;
  }

  return true;
}

/**
 * Converts trip members into the participant shape expected by split-bill logic.
 */
function toSplitParticipants(members: TripMember[]) {
  return members.map((member) => ({
    id: member.userId,
    displayName: member.displayName,
  }));
}

/**
 * Counts how many people are included in an expense split.
 */
function countExpenseParticipants(split: ExpenseSplit): number {
  if (split.type === "equal") {
    return split.userIds.length;
  }

  if (split.type === "fixed") {
    return split.amounts.length;
  }

  return split.shares.length;
}

/**
 * Extracts and validates the trip id route parameter.
 */
function parseTripParams(params: unknown, reply: FastifyReply): { tripId: string | null } {
  if (!params || typeof params !== "object" || typeof (params as { tripId?: unknown }).tripId !== "string") {
    reply.status(400).send({
      error: "INVALID_TRIP",
      message: "Trip id is required",
    });
    return { tripId: null };
  }

  return { tripId: (params as { tripId: string }).tripId };
}

/**
 * Extracts a member route id from route parameters.
 */
function parseRouteIdParam(params: unknown): string | null {
  if (!params || typeof params !== "object") {
    return null;
  }

  const routeId = (params as { routeId?: unknown }).routeId;
  return typeof routeId === "string" && routeId.length >= 8 && routeId.length <= 120 ? routeId : null;
}

/**
 * Validates the request body for creating a new trip.
 */
function parseCreateTripBody(body: unknown):
  | {
      ok: true;
      title: string;
      currency: CurrencyCode;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object" };
  }

  const input = body as Record<string, unknown>;
  const title = parseString(input.title);
  const currency = (parseString(input.currency) ?? "VND") as CurrencyCode;

  if (!title || title.length < 2 || title.length > 80) {
    return { ok: false, message: "Trip title must be between 2 and 80 characters" };
  }

  if (!supportedCurrencies.some((item) => item.code === currency)) {
    return { ok: false, message: "Currency is not supported" };
  }

  return {
    ok: true,
    title,
    currency,
  };
}

/**
 * Validates the request body for changing trip lifecycle status.
 */
function parseTripStatusBody(body: unknown):
  | {
      ok: true;
      status: TripStatus;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object" };
  }

  const status = parseTripStatus((body as Record<string, unknown>).status);

  if (!status) {
    return { ok: false, message: "Trạng thái chuyến đi không hợp lệ" };
  }

  return {
    ok: true,
    status,
  };
}

/**
 * Creates a readable, unique-enough trip id from a title.
 */
function createTripId(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  return `${slug || "trip"}-${randomUUID().slice(0, 8)}`;
}

/**
 * Parses and clamps chat message list limit.
 */
function parseMessageLimit(query: unknown): number {
  const input = query && typeof query === "object" ? (query as Record<string, unknown>) : {};
  const parsed = parseFiniteNumber(input.limit);
  return parsed === null ? 50 : Math.max(1, Math.min(100, Math.trunc(parsed)));
}

/**
 * Parses and clamps audit event list limit.
 */
function parseAuditLimit(query: unknown): number {
  const input = query && typeof query === "object" ? (query as Record<string, unknown>) : {};
  const parsed = parseFiniteNumber(input.limit);
  return parsed === null ? 80 : Math.max(1, Math.min(200, Math.trunc(parsed)));
}

/**
 * Parses POI filter query parameters.
 */
function parsePoiQuery(query: unknown): { kinds: TripPoiKind[]; limit: number } {
  const input = query && typeof query === "object" ? (query as Record<string, unknown>) : {};
  const kinds = parsePoiKinds(input.types);
  const limit = parseFiniteNumber(input.limit);

  return {
    kinds: kinds.length ? kinds : ["food", "lodging", "fuel"],
    limit: limit === null ? 80 : Math.max(1, Math.min(120, Math.trunc(limit))),
  };
}

/**
 * Parses the requested POI kinds and falls back to all supported kinds.
 */
function parsePoiKinds(value: unknown): TripPoiKind[] {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const kinds = new Set<TripPoiKind>();

  for (const raw of rawValues) {
    if (raw === "food" || raw === "lodging" || raw === "fuel") {
      kinds.add(raw);
    }
  }

  return [...kinds];
}

/**
 * Validates a chat message request body.
 */
function parseMessageBody(body: unknown):
  | {
      ok: true;
      body: string;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Nội dung gửi lên không hợp lệ" };
  }

  const input = body as Record<string, unknown>;
  const message = parseString(input.body);

  if (!message || message.length > 1000) {
    return { ok: false, message: "Tin nhắn phải có từ 1 đến 1000 ký tự" };
  }

  return {
    ok: true,
    body: message,
  };
}

/**
 * Validates the request body for creating a shared map marker.
 */
function parseMapMarkerBody(body: unknown):
  | {
      ok: true;
      marker: {
        label: string;
        kind: TripMapMarkerKind;
        latitude: number;
        longitude: number;
      };
    }
  | {
      ok: false;
      message: string;
    } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Nội dung gửi lên không hợp lệ" };
  }

  const input = body as Record<string, unknown>;
  const label = parseString(input.label);
  const kind = parseMapMarkerKind(input.kind);
  const latitude = parseFiniteNumber(input.latitude);
  const longitude = parseFiniteNumber(input.longitude);

  if (!label || label.length > 80) {
    return { ok: false, message: "Tên điểm đánh dấu phải có từ 1 đến 80 ký tự" };
  }

  if (!kind) {
    return { ok: false, message: "Loại điểm đánh dấu không hợp lệ" };
  }

  if (latitude === null || latitude < -90 || latitude > 90) {
    return { ok: false, message: "Vĩ độ phải nằm trong khoảng -90 đến 90" };
  }

  if (longitude === null || longitude < -180 || longitude > 180) {
    return { ok: false, message: "Kinh độ phải nằm trong khoảng -180 đến 180" };
  }

  return {
    ok: true,
    marker: {
      label,
      kind,
      latitude,
      longitude,
    },
  };
}

/**
 * Validates the request body for creating an expense.
 */
function parseCreateExpenseBody(body: unknown):
  | {
      ok: true;
      expense: Omit<StoredExpense, "id" | "createdAt">;
      clientMutationId?: string;
    }
  | {
      ok: false;
      message: string;
    } {
  // Validate the raw request body before it reaches split-bill logic or database writes.
  // This protects the API from malformed numbers, unsupported currencies, and oversized strings.
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object" };
  }

  const input = body as Record<string, unknown>;
  const title = parseString(input.title);
  const category = parseString(input.category);
  const paidByUserId = parseString(input.paidByUserId);
  const amount = parseString(input.amount);
  const currency = parseString(input.currency) as CurrencyCode | null;
  const clientMutationId = parseString(input.clientMutationId);
  const split = parseSplit(input.split);

  if (!title || title.length > 120) {
    return { ok: false, message: "Title is required and must be shorter than 120 characters" };
  }

  if (!category || category.length > 40) {
    return { ok: false, message: "Category is required and must be shorter than 40 characters" };
  }

  if (!paidByUserId) {
    return { ok: false, message: "Payer is required" };
  }

  if (!amount || !/^(0|[1-9]\d*)(\.\d+)?$/.test(amount)) {
    return { ok: false, message: "Amount must be a positive decimal string" };
  }

  if (!currency || !supportedCurrencies.some((item) => item.code === currency)) {
    return { ok: false, message: "Currency is not supported" };
  }

  if (clientMutationId && !/^[a-zA-Z0-9_-]{8,120}$/.test(clientMutationId)) {
    return { ok: false, message: "Client mutation id is invalid" };
  }

  if (!split.ok) {
    return split;
  }

  return {
    ok: true,
    expense: {
      title,
      category,
      paidByUserId,
      money: {
        amount,
        currency,
      },
      split: split.value,
    },
    ...(clientMutationId ? { clientMutationId } : {}),
  };
}

/**
 * Validates the request body for route planning.
 */
function parseRoutePlanBody(body: unknown):
  | {
      ok: true;
      input: {
        origin: string;
        destination: string;
        originCoordinate?: {
          lat: number;
          lng: number;
        };
        destinationCoordinate?: {
          lat: number;
          lng: number;
        };
      };
    }
  | {
      ok: false;
      message: string;
    } {
  // Route planning accepts either text labels or exact coordinates.
  // Coordinates are optional, but when provided they must pass parseGeoPoint range checks.
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object" };
  }

  const input = body as Record<string, unknown>;
  const origin = parseString(input.origin);
  const destination = parseString(input.destination);
  const originCoordinate = parseGeoPoint(input.originCoordinate);
  const destinationCoordinate = parseGeoPoint(input.destinationCoordinate);

  if (!originCoordinate && (!origin || origin.length < 2 || origin.length > 160)) {
    return { ok: false, message: "Điểm đi phải có từ 2 đến 160 ký tự" };
  }

  if (!destinationCoordinate && (!destination || destination.length < 2 || destination.length > 160)) {
    return { ok: false, message: "Điểm đến phải có từ 2 đến 160 ký tự" };
  }

  return {
    ok: true,
    input: {
      origin: origin ?? "Vị trí của bạn",
      destination: destination ?? "Điểm hẹn",
      ...(originCoordinate ? { originCoordinate } : {}),
      ...(destinationCoordinate ? { destinationCoordinate } : {}),
    },
  };
}

/**
 * Parses and validates a latitude/longitude object.
 */
function parseGeoPoint(value: unknown): { lat: number; lng: number } | undefined {
  // Never trust browser-provided coordinates blindly.
  // Latitude/longitude must be finite numbers within real Earth coordinate ranges.
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const lat = typeof input.lat === "number" ? input.lat : Number(input.lat);
  const lng = typeof input.lng === "number" ? input.lng : Number(input.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return undefined;
  }

  return { lat, lng };
}

/**
 * Validates a live GPS update request body.
 */
function parseLocationBody(body: unknown):
  | {
      ok: true;
      location: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number | null;
        speedMps?: number | null;
        headingDegrees?: number | null;
      };
    }
  | {
      ok: false;
      message: string;
    } {
  // Live GPS updates are accepted only with realistic coordinate and metadata ranges.
  // This prevents corrupted map pins and keeps impossible values out of the database.
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object" };
  }

  const input = body as Record<string, unknown>;
  const latitude = parseFiniteNumber(input.latitude);
  const longitude = parseFiniteNumber(input.longitude);
  const accuracyMeters = parseOptionalFiniteNumber(input.accuracyMeters);
  const speedMps = parseOptionalFiniteNumber(input.speedMps);
  const headingDegrees = parseOptionalFiniteNumber(input.headingDegrees);

  if (latitude === null || latitude < -90 || latitude > 90) {
    return { ok: false, message: "Latitude must be between -90 and 90" };
  }

  if (longitude === null || longitude < -180 || longitude > 180) {
    return { ok: false, message: "Longitude must be between -180 and 180" };
  }

  if (accuracyMeters === undefined || speedMps === undefined || headingDegrees === undefined) {
    return { ok: false, message: "Location metadata is invalid" };
  }

  if (accuracyMeters !== null && (accuracyMeters < 0 || accuracyMeters > 100_000)) {
    return { ok: false, message: "Accuracy is outside the supported range" };
  }

  if (speedMps !== null && (speedMps < 0 || speedMps > 140)) {
    return { ok: false, message: "Speed is outside the supported range" };
  }

  if (headingDegrees !== null && (headingDegrees < 0 || headingDegrees > 360)) {
    return { ok: false, message: "Heading must be between 0 and 360 degrees" };
  }

  return {
    ok: true,
    location: {
      latitude,
      longitude,
      accuracyMeters,
      speedMps,
      headingDegrees,
    },
  };
}

/**
 * Validates the request body for adding a trip member.
 */
function parseMemberBody(body: unknown):
  | {
      ok: true;
      displayName: string;
      userId: string;
      email?: string;
      role?: TripRole;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object" };
  }

  const input = body as Record<string, unknown>;
  const email = parseString(input.email);
  const normalizedEmail = email ? normalizeEmail(email) : undefined;
  const displayName = parseString(input.displayName) ?? (normalizedEmail ? displayNameFromEmail(normalizedEmail) : undefined);
  const userId = parseString(input.userId);
  const role = parseRole(input.role);

  if (!displayName || displayName.length > 80) {
    return { ok: false, message: "Display name or email is required and must be shorter than 80 characters" };
  }

  if (normalizedEmail && !isValidEmail(normalizedEmail)) {
    return { ok: false, message: "Email is not valid" };
  }

  if (userId && !/^[a-zA-Z0-9_-]{2,80}$/.test(userId)) {
    return { ok: false, message: "User id contains unsupported characters" };
  }

  if (input.role !== undefined && !role) {
    return { ok: false, message: "Role must be owner, editor, or viewer" };
  }

  return {
    ok: true,
    displayName,
    userId: normalizedEmail ? userIdFromEmail(normalizedEmail) : (userId ?? `guest_${randomUUID()}`),
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    ...(role ? { role } : {}),
  };
}

/**
 * Validates member role/profile update input.
 */
function parseMemberPatchBody(body: unknown):
  | {
      ok: true;
      patch: TripMemberPatch;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object" };
  }

  const input = body as Record<string, unknown>;
  const displayName = input.displayName === undefined ? undefined : parseString(input.displayName);
  const role = input.role === undefined ? undefined : parseRole(input.role);
  const phoneNumber = input.phoneNumber === undefined ? undefined : parseProfileText(input.phoneNumber, 24);
  const homeBase = input.homeBase === undefined ? undefined : parseProfileText(input.homeBase, 80);
  const travelStatus = input.travelStatus === undefined ? undefined : parseTripMemberTravelStatus(input.travelStatus);
  const statusEmoji = input.statusEmoji === undefined ? undefined : parseStatusEmoji(input.statusEmoji);
  const avatarColor = input.avatarColor === undefined ? undefined : parseTripMemberAvatarColor(input.avatarColor);
  const backgroundKey = input.backgroundKey === undefined ? undefined : parseTripMemberBackgroundKey(input.backgroundKey);

  if (input.displayName !== undefined && (!displayName || displayName.length > 80)) {
    return { ok: false, message: "Display name must be shorter than 80 characters" };
  }

  if (phoneNumber === undefined && input.phoneNumber !== undefined) {
    return { ok: false, message: "Phone number is too long" };
  }

  if (homeBase === undefined && input.homeBase !== undefined) {
    return { ok: false, message: "Home base is too long" };
  }

  if (input.role !== undefined && !role) {
    return { ok: false, message: "Role must be owner, editor, or viewer" };
  }

  if (input.travelStatus !== undefined && !travelStatus) {
    return { ok: false, message: "Travel status is not supported" };
  }

  if (input.statusEmoji !== undefined && !statusEmoji) {
    return { ok: false, message: "Status emoji must be 1 or 2 visible characters" };
  }

  if (input.avatarColor !== undefined && !avatarColor) {
    return { ok: false, message: "Avatar color is not supported" };
  }

  if (input.backgroundKey !== undefined && !backgroundKey) {
    return { ok: false, message: "Background preset is not supported" };
  }

  const hasProfilePatch =
    input.phoneNumber !== undefined ||
    input.homeBase !== undefined ||
    Boolean(travelStatus) ||
    Boolean(statusEmoji) ||
    Boolean(avatarColor) ||
    Boolean(backgroundKey);

  if (!displayName && !role && !hasProfilePatch) {
    return { ok: false, message: "Nothing to update" };
  }

  return {
    ok: true,
    patch: {
      ...(displayName ? { displayName } : {}),
      ...(role ? { role } : {}),
      ...(input.phoneNumber !== undefined ? { phoneNumber: phoneNumber ?? null } : {}),
      ...(input.homeBase !== undefined ? { homeBase: homeBase ?? null } : {}),
      ...(travelStatus ? { travelStatus } : {}),
      ...(statusEmoji ? { statusEmoji } : {}),
      ...(avatarColor ? { avatarColor } : {}),
      ...(backgroundKey ? { backgroundKey } : {}),
    },
  };
}

/**
 * Parses a trip role string.
 */
function parseRole(value: unknown): TripRole | null {
  return value === "owner" || value === "editor" || value === "viewer" ? value : null;
}

/**
 * Returns default optional profile fields for a new or reactivated member.
 */
function defaultMemberProfile(): Pick<TripMember, "phoneNumber" | "homeBase" | "travelStatus" | "statusEmoji" | "avatarColor" | "backgroundKey"> {
  return {
    phoneNumber: null,
    homeBase: null,
    travelStatus: "riding",
    statusEmoji: "🛵",
    avatarColor: "teal",
    backgroundKey: "forest",
  };
}

/**
 * Parses optional profile text while preserving the difference between omitted and cleared fields.
 */
function parseProfileText(value: unknown, maxLength: number): string | null | undefined {
  const parsed = parseString(value);

  if (!parsed) {
    return null;
  }

  return parsed.length <= maxLength ? parsed : undefined;
}

/**
 * Parses a member travel status value.
 */
function parseTripMemberTravelStatus(value: unknown): TripMemberTravelStatus | null {
  return value === "riding" || value === "resting" || value === "need-help" || value === "offline" ? value : null;
}

/**
 * Parses a member avatar color value.
 */
function parseTripMemberAvatarColor(value: unknown): TripMemberAvatarColor | null {
  return value === "teal" || value === "sky" || value === "green" || value === "amber" || value === "rose" || value === "violet" ? value : null;
}

/**
 * Parses a member background theme value.
 */
function parseTripMemberBackgroundKey(value: unknown): TripMemberBackgroundKey | null {
  return value === "forest" || value === "coast" || value === "mountain" || value === "night" || value === "sunrise" ? value : null;
}

/**
 * Parses a short emoji/status marker for a member profile.
 */
function parseStatusEmoji(value: unknown): string | null {
  const parsed = parseString(value);

  if (!parsed) {
    return null;
  }

  return [...parsed].length <= 2 ? parsed : null;
}

/**
 * Parses a trip lifecycle status.
 */
function parseTripStatus(value: unknown): TripStatus | null {
  return value === "active" || value === "completed" || value === "archived" ? value : null;
}

/**
 * Parses a shared map marker kind.
 */
function parseMapMarkerKind(value: unknown): TripMapMarkerKind | null {
  return value === "ping" ||
    value === "meetup" ||
    value === "fuel" ||
    value === "repair" ||
    value === "warning" ||
    value === "food" ||
    value === "lodging"
    ? value
    : null;
}

/**
 * Extracts a member id from route parameters.
 */
function parseMemberId(params: unknown): string | null {
  if (!params || typeof params !== "object") {
    return null;
  }

  return parseString((params as { memberId?: unknown }).memberId);
}

/**
 * Extracts a marker id from route parameters.
 */
function parseMarkerId(params: unknown): string | null {
  if (!params || typeof params !== "object") {
    return null;
  }

  return parseString((params as { markerId?: unknown }).markerId);
}

/**
 * Returns whether a member is still active in the current trip.
 */
function isActiveTripMember(member: TripMember): boolean {
  return member.active;
}

/**
 * Checks that an expense references only active trip members.
 */
function isExpenseLimitedToMembers(expense: StoredExpense, members: TripMember[]): boolean {
  const activeMemberIds = new Set(members.map((member) => member.userId));

  if (!activeMemberIds.has(expense.paidByUserId)) {
    return false;
  }

  if (expense.split.type === "equal") {
    return expense.split.userIds.every((userId) => activeMemberIds.has(userId));
  }

  if (expense.split.type === "percentage" || expense.split.type === "share") {
    return expense.split.shares.every((share) => activeMemberIds.has(share.userId));
  }

  return expense.split.amounts.every((amount) => activeMemberIds.has(amount.userId));
}

/**
 * Parses and validates the split-bill payload for one expense.
 */
function parseSplit(value: unknown):
  | {
      ok: true;
      value: ExpenseSplit;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!value || typeof value !== "object") {
    return { ok: false, message: "Split is required" };
  }

  const input = value as Record<string, unknown>;
  const type = parseString(input.type);

  if (type === "equal") {
    const userIds = parseStringArray(input.userIds);
    return userIds.length ? { ok: true, value: { type, userIds } } : { ok: false, message: "Equal split needs users" };
  }

  if (type === "percentage") {
    const shares = parseArray(input.shares)
      .map((item) => parseObject(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        userId: parseString(item.userId) ?? "",
        percentage: parseString(item.percentage) ?? "",
      }));

    return shares.length ? { ok: true, value: { type, shares } } : { ok: false, message: "Percentage split needs shares" };
  }

  if (type === "share") {
    const shares = parseArray(input.shares)
      .map((item) => parseObject(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        userId: parseString(item.userId) ?? "",
        shares: parseString(item.shares) ?? "",
      }));

    return shares.length ? { ok: true, value: { type, shares } } : { ok: false, message: "Share split needs shares" };
  }

  if (type === "fixed") {
    const amounts = parseArray(input.amounts)
      .map((item) => parseObject(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        userId: parseString(item.userId) ?? "",
        amount: parseString(item.amount) ?? "",
        currency: (parseString(item.currency) ?? "") as CurrencyCode,
      }));

    return amounts.length ? { ok: true, value: { type, amounts } } : { ok: false, message: "Fixed split needs amounts" };
  }

  return { ok: false, message: "Split type is not supported" };
}

/**
 * Parses a non-empty trimmed string.
 */
function parseString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Parses a finite number from a primitive value.
 */
function parseFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses an optional finite number, preserving null and omitted separately.
 */
function parseOptionalFiniteNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = parseFiniteNumber(value);
  return parsed === null ? undefined : parsed;
}

/**
 * Parses an array of strings, dropping non-string values.
 */
function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(parseString).filter((item): item is string => Boolean(item)) : [];
}

/**
 * Returns an array value or an empty array when the input is not an array.
 */
function parseArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Returns a plain object-like record or null.
 */
function parseObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Converts split-bill domain errors into HTTP responses.
 */
function sendSplitBillError(reply: FastifyReply, error: unknown) {
  if (error instanceof SplitBillError) {
    return reply.status(400).send({
      error: error.code,
      message: error.message,
    });
  }

  throw error;
}

/**
 * Converts route-planner domain errors into HTTP responses.
 */
function sendRoutePlannerError(reply: FastifyReply, error: unknown) {
  if (error instanceof RoutePlannerError) {
    const statusCode = error.code === "INVALID_ROUTE_INPUT" ? 400 : error.code === "GEOCODE_NOT_FOUND" || error.code === "ROUTE_NOT_FOUND" ? 404 : 502;

    return reply.status(statusCode).send({
      error: error.code,
      message: error.message,
    });
  }

  throw error;
}

/**
 * Parses the comma-separated CORS origin allowlist from environment variables.
 */
function parseCorsOrigins(value: string | undefined): string[] {
  const localOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

  if (!value) {
    return localOrigins;
  }

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length ? origins : localOrigins;
}

/**
 * Builds SSE headers with the resolved CORS origin.
 */
function buildLiveSyncHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };

  const allowedOrigin = resolveCorsOrigin(origin);

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = "Origin";
  }

  return headers;
}

/**
 * Resolves whether a request origin is allowed to receive live-sync responses.
 */
function resolveCorsOrigin(origin: string | undefined): string | null {
  if (!origin) {
    return null;
  }

  const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

  if (allowedOrigins.includes("*")) {
    return origin;
  }

  return allowedOrigins.includes(origin) ? origin : null;
}
