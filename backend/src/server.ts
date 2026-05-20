import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

import { verifyFirebaseBearerToken } from "./auth/firebaseAuth.js";
import { toSafeUser, type UserAccount } from "./auth/types.js";
import { displayNameFromEmail, isValidEmail, normalizeEmail, userIdFromEmail } from "./auth/userIdentity.js";
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
import { InMemoryRoutePlanRepository, PostgresRoutePlanRepository, type RoutePlanRepository } from "./route/routePlanRepository.js";
import { buildOpenStreetRoutePlan, buildStarterRoutePlan, RoutePlannerError } from "./route/routePlanner.js";
import { canManageMembers, canWriteTrip, TripAccessService, type TripRole } from "./trips/tripAccess.js";
import { InMemoryTripRepository, PostgresTripRepository, type TripRepository } from "./trips/tripRepository.js";
import {
  InMemoryTripMemberRepository,
  PostgresTripMemberRepository,
  type TripMember,
  type TripMemberRepository,
} from "./trips/tripMemberRepository.js";

const databaseUrl = getDatabaseUrl();
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !databaseUrl) {
  throw new Error("DATABASE_URL is required when NODE_ENV=production. Refusing to start with in-memory local data.");
}

const pool = databaseUrl ? createPool() : null;
const repository: ExpenseRepository = pool ? new PostgresExpenseRepository(pool) : new InMemoryExpenseRepository();
const memberRepository: TripMemberRepository = pool ? new PostgresTripMemberRepository(pool) : new InMemoryTripMemberRepository();
const locationRepository: TripMemberLocationRepository = pool
  ? new PostgresTripMemberLocationRepository(pool)
  : new InMemoryTripMemberLocationRepository();
const routePlanRepository: RoutePlanRepository = pool ? new PostgresRoutePlanRepository(pool) : new InMemoryRoutePlanRepository();
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
  origin: parseCorsOrigins(process.env.CORS_ORIGINS),
  credentials: true,
});

await app.register(rateLimit, {
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

  await memberRepository.add(trip.id, {
    userId: user.id,
    displayName: user.displayName,
    role: "owner",
  });
  await tripRepository.linkUser(trip.id, user.id, "owner");

  return reply.status(201).send({
    trip: {
      ...trip,
      role: "owner",
    },
  });
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

    return {
      routePlan: savedRoutePlan,
    };
  } catch (error) {
    return sendRoutePlannerError(reply, error);
  }
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

  await locationRepository.pruneExpired();

  return {
    locations: await locationRepository.listActiveByTrip(tripId),
  };
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
  };

  try {
    const addedMember = await memberRepository.add(tripId, member);
    await tripRepository.linkUser(tripId, addedMember.userId, addedMember.role);
    publishTripChange(tripId, user.id, "member_changed");

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

  if (!user || !(await requireTripRole(reply, tripId, user.id, "manage"))) {
    return;
  }

  const parsed = parseMemberPatchBody(request.body);

  if (!parsed.ok) {
    return reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: parsed.message,
    });
  }

  if (memberId === user.id && parsed.patch.role && parsed.patch.role !== "owner") {
    return reply.status(400).send({
      error: "OWNER_SELF_DOWNGRADE",
      message: "Owner cannot downgrade their own role",
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
    return reply.status(400).send({
      error: "OWNER_SELF_REMOVE",
      message: "You cannot remove yourself from the trip",
    });
  }

  const expenses = await repository.listByTrip(tripId);

  if (isMemberReferenced(expenses, memberId)) {
    return reply.status(409).send({
      error: "MEMBER_HAS_EXPENSES",
      message: "Member already appears in expenses and cannot be removed",
    });
  }

  await memberRepository.remove(tripId, memberId);
  await tripRepository.unlinkUser(tripId, memberId);
  publishTripChange(tripId, user.id, "member_changed");
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

  const nextExpenses = [expense, ...(await repository.listByTrip(tripId))];
  const participants = toSplitParticipants(await memberRepository.listByTrip(tripId));

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

function publishTripChange(tripId: string, actorUserId: string, type: LiveSyncEventType, actorDisplayName?: string) {
  liveSyncHub.publish({
    tripId,
    actorUserId,
    type,
    ...(actorDisplayName ? { actorDisplayName } : {}),
  });
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<UserAccount | null> {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    reply.status(401).send({
      error: "MISSING_ACCESS_TOKEN",
      message: "Access token is required",
    });
    return null;
  }

  try {
    const user = await verifyFirebaseBearerToken(authorization.slice("Bearer ".length));

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

async function requireTripRole(reply: FastifyReply, tripId: string, userId: string, mode: "read" | "write" | "manage"): Promise<boolean> {
  const role = await tripAccess.getRole(tripId, userId);

  if (!role || (mode === "write" && !canWriteTrip(role)) || (mode === "manage" && !canManageMembers(role))) {
    reply.status(403).send({
      error: "FORBIDDEN",
      message: "You do not have access to this trip",
    });
    return false;
  }

  return true;
}

function toSplitParticipants(members: TripMember[]) {
  return members.map((member) => ({
    id: member.userId,
    displayName: member.displayName,
  }));
}

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
      };
    }
  | {
      ok: false;
      message: string;
    } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object" };
  }

  const input = body as Record<string, unknown>;
  const origin = parseString(input.origin);
  const destination = parseString(input.destination);
  const originCoordinate = parseGeoPoint(input.originCoordinate);

  if (!originCoordinate && (!origin || origin.length < 2 || origin.length > 160)) {
    return { ok: false, message: "Origin must be between 2 and 160 characters" };
  }

  if (!destination || destination.length < 2 || destination.length > 160) {
    return { ok: false, message: "Destination must be between 2 and 160 characters" };
  }

  return {
    ok: true,
    input: {
      origin: origin ?? "Vi tri cua ban",
      destination,
      ...(originCoordinate ? { originCoordinate } : {}),
    },
  };
}

function parseGeoPoint(value: unknown): { lat: number; lng: number } | undefined {
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

function parseMemberPatchBody(body: unknown):
  | {
      ok: true;
      patch: {
        displayName?: string;
        role?: TripRole;
      };
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

  if (input.displayName !== undefined && (!displayName || displayName.length > 80)) {
    return { ok: false, message: "Display name must be shorter than 80 characters" };
  }

  if (input.role !== undefined && !role) {
    return { ok: false, message: "Role must be owner, editor, or viewer" };
  }

  if (!displayName && !role) {
    return { ok: false, message: "Nothing to update" };
  }

  return {
    ok: true,
    patch: {
      ...(displayName ? { displayName } : {}),
      ...(role ? { role } : {}),
    },
  };
}

function parseRole(value: unknown): TripRole | null {
  return value === "owner" || value === "editor" || value === "viewer" ? value : null;
}

function parseMemberId(params: unknown): string | null {
  if (!params || typeof params !== "object") {
    return null;
  }

  return parseString((params as { memberId?: unknown }).memberId);
}

function isMemberReferenced(expenses: StoredExpense[], userId: string): boolean {
  return expenses.some((expense) => {
    if (expense.paidByUserId === userId) {
      return true;
    }

    if (expense.split.type === "equal") {
      return expense.split.userIds.includes(userId);
    }

    if (expense.split.type === "percentage" || expense.split.type === "share") {
      return expense.split.shares.some((share) => share.userId === userId);
    }

    return expense.split.amounts.some((amount) => amount.userId === userId);
  });
}

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

function parseString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function parseFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalFiniteNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = parseFiniteNumber(value);
  return parsed === null ? undefined : parsed;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(parseString).filter((item): item is string => Boolean(item)) : [];
}

function parseArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sendSplitBillError(reply: FastifyReply, error: unknown) {
  if (error instanceof SplitBillError) {
    return reply.status(400).send({
      error: error.code,
      message: error.message,
    });
  }

  throw error;
}

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
