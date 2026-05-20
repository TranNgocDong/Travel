"use client";

import {
  ArrowRightLeft,
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
  Moon,
  Navigation,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sun,
  Users,
  WalletCards,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addTripMember,
  createExpense,
  createTrip,
  defaultTripId,
  fetchExpenses,
  fetchMe,
  fetchRoutePlan,
  fetchTripLocations,
  fetchSettlementResult,
  fetchTripMembers,
  fetchTrips,
  getCurrentFirebaseUser,
  login,
  loginWithGoogle,
  logout,
  planRoute,
  removeTripMember,
  shareMyLocation,
  subscribeToTripEvents,
  stopSharingMyLocation,
  updateTripMember,
  type ApiBalance,
  type ApiCreateExpensePayload,
  type ApiExpense,
  type ApiExpenseSplit,
  type ApiGeoPoint,
  type ApiMemberLocation,
  type ApiRoutePlan,
  type ApiRouteStopKind,
  type ApiRouteWaypoint,
  type ApiSettlement,
  type ApiTrip,
  type ApiTripLiveEvent,
  type ApiTripMember,
  type ApiTripRole,
  type ApiUser,
} from "@/lib/api";
import { currencyRatesToVnd, formatMoney, type CurrencyCode, type Member, type SplitMode, toVnd } from "@/lib/settlements";

type TripMemberView = Member & {
  role: ApiTripRole;
};

type MobileTab = "route" | "expenses" | "group";

type OfflineExpenseQueueItem = {
  id: string;
  tripId: string;
  payload: ApiCreateExpensePayload;
  createdAt: string;
};

const categories = [
  { id: "fuel", label: "Xang", icon: Fuel },
  { id: "food", label: "An uong", icon: ReceiptText },
  { id: "hotel", label: "Ngu nghi", icon: Bike },
  { id: "border", label: "Cua khau", icon: ShieldCheck },
];

const locationShareIntervalMs = 15_000;

export function ExpensePlanner() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [activeTab, setActiveTab] = useState<MobileTab>("route");
  const [expenses, setExpenses] = useState<ApiExpense[]>([]);
  const [members, setMembers] = useState<TripMemberView[]>([]);
  const [trips, setTrips] = useState<ApiTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState(defaultTripId);
  const [balances, setBalances] = useState<ApiBalance[]>([]);
  const [settlements, setSettlements] = useState<ApiSettlement[]>([]);
  const [memberLocations, setMemberLocations] = useState<ApiMemberLocation[]>([]);
  const [routePlan, setRoutePlan] = useState<ApiRoutePlan | null>(null);
  const [routeOrigin, setRouteOrigin] = useState("");
  const [routeOriginCoordinate, setRouteOriginCoordinate] = useState<ApiGeoPoint | null>(null);
  const [routeDestination, setRouteDestination] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("VND");
  const [payerId, setPayerId] = useState("");
  const [category, setCategory] = useState(categories[1]?.id ?? "food");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
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
  const [isUsingCurrentLocation, setIsUsingCurrentLocation] = useState(false);
  const [isSharingLocation, setIsSharingLocation] = useState(false);
  const [locationShareStatus, setLocationShareStatus] = useState<LocationShareStatus>("idle");
  const [apiError, setApiError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<ApiTripRole>("viewer");
  const loadTripDataInFlightRef = useRef(false);
  const routeFormDirtyRef = useRef(false);
  const locationShareWatchIdRef = useRef<number | null>(null);
  const lastSharedPositionAtRef = useRef(0);

  function applyRoutePlan(nextRoutePlan: ApiRoutePlan, options: { cache?: boolean; fromCache?: boolean; tripId?: string } = {}) {
    routeFormDirtyRef.current = false;
    setRoutePlan(nextRoutePlan);
    setRouteOrigin(nextRoutePlan.origin);
    setRouteOriginCoordinate(null);
    setRouteDestination(nextRoutePlan.destination);
    setOfflineReady(true);
    setIsUsingOfflineRoute(Boolean(options.fromCache));

    if (options.cache !== false) {
      writeCachedRoutePlan(nextRoutePlan, options.tripId ?? selectedTripId);
    }
  }

  function refreshQueuedExpenseCount() {
    setQueuedExpenseCount(readQueuedExpenses().length);
  }

  const loadTripData = useCallback(async (options: { silent?: boolean } = {}) => {
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

    if (cachedRoutePlan && canUpdateRouteForm) {
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
        setMemberLocations([]);
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

      const [nextMembers, nextExpenses, result, nextRoutePlan, nextLocations] = await Promise.all([
        fetchTripMembers(selectedTripId),
        fetchExpenses(selectedTripId),
        fetchSettlementResult(selectedTripId),
        fetchRoutePlan(selectedTripId),
        fetchTripLocations(selectedTripId).catch(() => []),
      ]);
      const mappedMembers = nextMembers.map(mapTripMember);
      const memberIds = mappedMembers.map((member) => member.id);
      setMembers(mappedMembers);
      setPayerId((current) => (current && memberIds.includes(current) ? current : (memberIds[0] ?? "")));
      setParticipantIds((current) => {
        const valid = current.filter((id) => memberIds.includes(id));
        return valid.length ? valid : memberIds;
      });
      setExpenses(nextExpenses);
      setBalances(result.balances);
      setSettlements(result.settlements);
      setMemberLocations(nextLocations);
      if (canUpdateRouteForm) {
        applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      } else {
        writeCachedRoutePlan(nextRoutePlan, selectedTripId);
      }
      setLastSyncedAt(new Date());
    } catch (error) {
      const cached = cachedRoutePlan ?? readCachedRoutePlan(selectedTripId);

      if (cached && canUpdateRouteForm) {
        applyRoutePlan(cached, { cache: false, fromCache: true });
        if (!options.silent) {
          setApiError("Dang dung tuyen da luu trong may vi API tam thoi khong ket noi duoc");
        }
      } else {
        if (!options.silent) {
          setApiError(error instanceof Error ? error.message : "Khong ket noi duoc API");
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

  const loadTripLocations = useCallback(async (targetTripId = selectedTripId) => {
    try {
      setMemberLocations(await fetchTripLocations(targetTripId));
    } catch {
      // GPS sharing is helpful, but it should not block the rest of the trip screen.
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
    const savedTheme = window.localStorage.getItem("trail-ledger-theme");
    const nextTheme = savedTheme === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    refreshQueuedExpenseCount();

    const savedTripId = window.localStorage.getItem(selectedTripCacheKey());

    if (savedTripId) {
      setSelectedTripId(savedTripId);
    }
  }, []);

  useEffect(() => {
    void getCurrentFirebaseUser().then((firebaseUser) => {
      if (!firebaseUser) {
        setIsLoading(false);
        return;
      }

      void fetchMe()
        .then((user) => {
          setCurrentUser(user);
        })
        .catch(() => {
          setCurrentUser(null);
          setIsLoading(false);
        });
    });
  }, []);

  useEffect(() => {
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
  const currentTripRole = members.find((member) => member.id === currentUser?.id)?.role ?? "viewer";
  const canManageTripMembers = currentTripRole === "owner";
  const activeTrip = trips.find((trip) => trip.id === selectedTripId);
  const syncStatusValue = queuedExpenseCount
    ? `Cho ${queuedExpenseCount}`
    : isLiveSyncConnected
      ? "Live"
    : isRefreshingData
      ? "Dang cap nhat"
      : lastSyncedAt
        ? formatSyncTime(lastSyncedAt)
        : isLoading
          ? "Dang tai"
          : isUsingOfflineRoute
            ? "Offline"
            : offlineReady
              ? "Da luu"
              : "Chua luu";

  useEffect(() => {
    if (!currentUser || !activeTrip?.id) {
      setIsLiveSyncConnected(false);
      return;
    }

    let refreshTimeout: number | null = null;
    const unsubscribe = subscribeToTripEvents(activeTrip.id, {
      onOpen: () => {
        setIsLiveSyncConnected(true);
      },
      onError: () => {
        setIsLiveSyncConnected(false);
      },
      onEvent: (event) => {
        if (event.tripId !== activeTrip.id) {
          return;
        }

        setLastLiveSyncEvent(event);

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
  }, [activeTrip?.id, currentUser, loadTripData, loadTripLocations]);

  useEffect(() => {
    return () => {
      clearLocationShareWatch();
    };
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("trail-ledger-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  function toggleParticipant(memberId: string) {
    setParticipantIds((current) => {
      if (current.includes(memberId)) {
        return current.length === 1 ? current : current.filter((id) => id !== memberId);
      }

      return [...current, memberId];
    });
  }

  function updateSplitValue(memberId: string, value: string) {
    setSplitValues((current) => ({
      ...current,
      [memberId]: value,
    }));
  }

  function clearLocationShareWatch() {
    if (locationShareWatchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(locationShareWatchIdRef.current);
    }

    locationShareWatchIdRef.current = null;
  }

  function handleStartSharingLocation() {
    if (!currentUser || !selectedTripId) {
      return;
    }

    if (!("geolocation" in navigator)) {
      setLocationShareStatus("unavailable");
      setApiError("Trinh duyet khong lay duoc vi tri GPS");
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
            setApiError(error instanceof Error ? error.message : "Khong chia se duoc vi tri");
          });
      },
      (error) => {
        clearLocationShareWatch();
        setIsSharingLocation(false);
        setLocationShareStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
        setApiError(error.code === error.PERMISSION_DENIED ? "Can cho phep quyen vi tri de chia se GPS" : "Khong lay duoc vi tri GPS");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    );
  }

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
        // The shared point expires automatically, so failing to stop it immediately is not critical.
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount);

    if (!title.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || participantIds.length === 0 || isSaving) {
      return;
    }

    setIsSaving(true);
    setApiError(null);

    const clientMutationId = createClientMutationId();
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
        setApiError("Da luu tam chi phi trong may. Co mang lai se tu dong dong bo.");
      } else {
        setApiError(error instanceof Error ? error.message : "Khong luu duoc chi phi");
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoggingIn(true);
    setApiError(null);

    try {
      const user = await login(loginEmail, loginPassword);
      setCurrentUser(user);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Dang nhap that bai");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleGoogleLogin() {
    setIsLoggingIn(true);
    setApiError(null);

    try {
      const user = await loginWithGoogle();
      setCurrentUser(user);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Dang nhap Google that bai");
    } finally {
      setIsLoggingIn(false);
    }
  }

  function handleRouteOriginChange(value: string) {
    routeFormDirtyRef.current = true;
    setRouteOrigin(value);
    setRouteOriginCoordinate(null);
  }

  function handleRouteDestinationChange(value: string) {
    routeFormDirtyRef.current = true;
    setRouteDestination(value);
  }

  async function handlePlanRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if ((!routeOrigin.trim() && !routeOriginCoordinate) || !routeDestination.trim() || isPlanningRoute) {
      return;
    }

    setIsPlanningRoute(true);
    setApiError(null);

    try {
      const nextRoutePlan = await planRoute({
        origin: routeOriginCoordinate ? routeOrigin.trim() || "Vi tri cua ban" : routeOrigin.trim(),
        destination: routeDestination.trim(),
        ...(routeOriginCoordinate ? { originCoordinate: routeOriginCoordinate } : {}),
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Khong ve duoc tuyen");
    } finally {
      setIsPlanningRoute(false);
    }
  }

  async function handlePlanRouteFromCurrentLocation() {
    if (!routeDestination.trim() || isPlanningRoute || isUsingCurrentLocation) {
      return;
    }

    if (!("geolocation" in navigator)) {
      setApiError("Trinh duyet khong lay duoc vi tri GPS");
      return;
    }

    setIsUsingCurrentLocation(true);
    setApiError(null);

    try {
      const position = await getCurrentBrowserPosition();
      const originCoordinate = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      setRouteOrigin("Vi tri cua toi");
      setRouteOriginCoordinate(originCoordinate);
      setIsPlanningRoute(true);

      const nextRoutePlan = await planRoute({
        origin: "Vi tri cua toi",
        destination: routeDestination.trim(),
        originCoordinate,
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Khong lay duoc vi tri hien tai");
    } finally {
      setIsUsingCurrentLocation(false);
      setIsPlanningRoute(false);
    }
  }

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
    setMemberLocations([]);
    const cachedRoutePlan = readCachedRoutePlan(nextTripId);

    if (cachedRoutePlan) {
      applyRoutePlan(cachedRoutePlan, { cache: false, fromCache: true, tripId: nextTripId });
    } else {
      setRoutePlan(null);
      setOfflineReady(false);
    }
  }

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
      setApiError(error instanceof Error ? error.message : "Khong tao duoc chuyen di");
    } finally {
      setIsCreatingTrip(false);
    }
  }

  function handleSyncQueuedExpenses() {
    void syncQueuedExpenses();
  }

  function handleRefreshTripData() {
    void loadTripData({ silent: true });
  }

  async function handleLogout() {
    await handleStopSharingLocation();
    await logout();
    setCurrentUser(null);
    setTrips([]);
    setExpenses([]);
    setBalances([]);
    setSettlements([]);
    setMembers([]);
    setMemberLocations([]);
    setRoutePlan(null);
    setLastSyncedAt(null);
  }

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
      setApiError(error instanceof Error ? error.message : "Khong them duoc thanh vien");
    }
  }

  async function handleRoleChange(memberId: string, role: ApiTripRole) {
    setApiError(null);

    try {
      await updateTripMember(memberId, { role }, selectedTripId);
      await loadTripData();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Khong doi duoc quyen");
    }
  }

  async function handleRemoveMember(memberId: string) {
    setApiError(null);

    try {
      await removeTripMember(memberId, selectedTripId);
      await loadTripData();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Khong xoa duoc thanh vien");
    }
  }

  if (!currentUser) {
    return (
      <main className="app-shell auth-shell">
        <header className="top-bar">
          <div className="brand-mark" aria-hidden="true">
            <Bike size={20} />
          </div>
          <div className="brand-copy">
            <p>TrailLedger</p>
            <span>Secure trip workspace</span>
          </div>
          <button className="icon-button" type="button" title="Doi giao dien" aria-label="Doi giao dien" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>

        <form className="expense-panel auth-panel" onSubmit={handleLogin}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Bao mat</span>
              <h1>Dang nhap</h1>
            </div>
            <ShieldCheck size={24} />
          </div>

          {apiError && (
            <div className="api-alert" role="alert">
              {apiError}
            </div>
          )}

          <label className="field">
            <span>Email</span>
            <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="you@example.com" />
          </label>

          <label className="field auth-password">
            <span>Mat khau</span>
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="Mat khau Firebase"
            />
          </label>

          <button className="auth-submit" type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? "Dang vao..." : "Dang nhap"}
          </button>

          <button className="google-submit" type="button" disabled={isLoggingIn} onClick={handleGoogleLogin}>
            <span aria-hidden="true">G</span>
            Dang nhap voi Google
          </button>

          <div className="rate-note">
            <ShieldCheck size={16} />
            <span>Email/mat khau can tao user truoc. Google chi can bat provider trong Firebase Console.</span>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell" data-active-tab={activeTab}>
      <header className="top-bar">
        <div className="brand-mark" aria-hidden="true">
          <Bike size={20} />
        </div>
        <div className="brand-copy">
          <p>TrailLedger</p>
            <span>
              {currentUser.displayName} - {activeTrip?.title ?? "Chua co chuyen"}
            </span>
        </div>
        <div className="top-actions">
          <button className="icon-button" type="button" title="Doi giao dien" aria-label="Doi giao dien" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button className="logout-button" type="button" onClick={handleLogout}>
            Thoat
          </button>
        </div>
      </header>

      <section className="trip-manager" aria-label="Quan ly chuyen di">
        <label>
          <span>Chuyen di</span>
          <select value={selectedTripId} onChange={(event) => handleTripChange(event.target.value)} disabled={!trips.length || isLoading}>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </select>
        </label>

        <form className="trip-create-form" onSubmit={handleCreateTrip}>
          <input value={newTripTitle} onChange={(event) => setNewTripTitle(event.target.value)} placeholder="Ten chuyen moi" />
          <button type="submit" disabled={isCreatingTrip || !newTripTitle.trim()} title="Tao chuyen" aria-label="Tao chuyen">
            <Plus size={18} />
          </button>
        </form>
      </section>

      <section className="trip-strip" aria-label="Thong tin chang di">
        <div className="route-card">
          <div>
            <span className="eyebrow">Chang hom nay</span>
            <h1>{routePlan && routePlan.totalDistanceKm > 0 ? `${routePlan.totalDistanceKm} km` : "0 km"}</h1>
          </div>
          <div className="route-line" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="route-meta">
            <span>{routePlan && routePlan.durationMinutes > 0 ? `${Math.round(routePlan.durationMinutes / 60)} gio` : "Chua co tuyen"}</span>
            <strong>{routePlan?.destination || "Tao tuyen moi"}</strong>
          </div>
        </div>

        <div className={offlineReady ? "offline-pill ready" : "offline-pill"} aria-live="polite">
          {offlineReady ? <Check size={16} /> : <Download size={16} />}
          <span>{isUsingOfflineRoute ? "Dang xem offline" : offlineReady ? "Da luu offline" : "Chua luu offline"}</span>
        </div>
      </section>

      <section className="summary-grid" aria-label="Tong quan chi phi">
        <SummaryTile icon={<WalletCards size={18} />} label="Tong chi" value={formatMoney(totalVnd)} />
        <SummaryTile icon={<ArrowRightLeft size={18} />} label="Can tra" value={`${settlements.length} luot`} />
        <SummaryTile icon={<CloudRain size={18} />} label="Thoi tiet" value={`${routePlan?.summary.weatherAlerts ?? 0} canh bao`} />
        <SummaryTile
          icon={<RefreshCw size={18} />}
          label="Dong bo"
          value={syncStatusValue}
        />
      </section>

      <nav className="mobile-tabs" aria-label="Chuyen man hinh">
        <button className={tabButtonClass(activeTab, "route")} type="button" onClick={() => setActiveTab("route")}>
          <Map size={17} />
          <span>Ban do</span>
        </button>
        <button className={tabButtonClass(activeTab, "expenses")} type="button" onClick={() => setActiveTab("expenses")}>
          <WalletCards size={17} />
          <span>Chi phi</span>
        </button>
        <button className={tabButtonClass(activeTab, "group")} type="button" onClick={() => setActiveTab("group")}>
          <Users size={17} />
          <span>Nhom</span>
        </button>
      </nav>

      {apiError && (
        <div className="api-alert" role="alert">
          {apiError}
        </div>
      )}

      <div className="live-sync-bar" role="status">
        <RefreshCw size={17} className={isRefreshingData ? "spinning" : ""} />
        <span>
          {isRefreshingData
            ? "Dang cap nhat du lieu nhom..."
            : isLiveSyncConnected
              ? lastLiveSyncEvent
                ? `Live sync: ${liveEventLabel(lastLiveSyncEvent.type)}`
                : "Live sync dang bat"
              : lastSyncedAt
                ? `Da dong bo luc ${formatSyncTime(lastSyncedAt)}`
                : "Chua dong bo du lieu nhom"}
        </span>
        <button type="button" disabled={isRefreshingData || isLoading} onClick={handleRefreshTripData}>
          {isRefreshingData ? "Dang tai" : "Lam moi"}
        </button>
      </div>

      {queuedExpenseCount > 0 && (
        <div className="sync-alert" role="status">
          <CloudOff size={17} />
          <span>
            {queuedExpenseCount} chi phi dang cho dong bo{isSyncingExpenses ? "..." : ""}
          </span>
          <button type="button" disabled={isSyncingExpenses} onClick={handleSyncQueuedExpenses}>
            {isSyncingExpenses ? "Dang dong bo" : "Dong bo"}
          </button>
        </div>
      )}

      {!trips.length && !isLoading && (
        <section className="empty-state" aria-label="Bat dau chuyen di">
          <Map size={24} />
          <div>
            <h2>Chua co chuyen di</h2>
            <p>Tao chuyen dau tien, sau do them thanh vien, ve tuyen va ghi chi phi cua ban.</p>
          </div>
        </section>
      )}

      {routePlan && trips.length > 0 && (
        <RouteIntelligence
          destination={routeDestination}
          currentUserId={currentUser.id}
          isPlanningRoute={isPlanningRoute}
          isSharingLocation={isSharingLocation}
          isUsingCurrentLocation={isUsingCurrentLocation}
          locationShareStatus={locationShareStatus}
          memberLocations={memberLocations}
          onDestinationChange={handleRouteDestinationChange}
          onOriginChange={handleRouteOriginChange}
          onPlanRoute={handlePlanRoute}
          onPlanRouteFromCurrentLocation={handlePlanRouteFromCurrentLocation}
          onStartSharingLocation={handleStartSharingLocation}
          onStopSharingLocation={handleStopSharingLocation}
          origin={routeOrigin}
          originCoordinate={routeOriginCoordinate}
          routePlan={routePlan}
        />
      )}

      {trips.length > 0 && (
        <>
          <section className="workspace">
            <form className="expense-panel" onSubmit={handleSubmit}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Khoan moi</span>
              <h2>Ghi chi phi</h2>
            </div>
            <button className="primary-icon" type="submit" title="Luu chi phi" aria-label="Luu chi phi" disabled={isSaving || !members.length}>
              <Plus size={20} />
            </button>
          </div>

          <label className="field">
            <span>Ten khoan</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Vi du: Xang, an trua, khach san" />
          </label>

          <div className="amount-row">
            <label className="field amount-field">
              <span>So tien</span>
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
            </label>
            <div className="currency-switch" aria-label="Tien te">
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
          </div>

          <div className="category-row" aria-label="Danh muc">
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

          <div className="select-row">
            <label className="field">
              <span>Nguoi tra</span>
              <select value={payerId} onChange={(event) => setPayerId(event.target.value)}>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="mode-switch" aria-label="Kieu chia">
              {(["equal", "percent", "share"] satisfies SplitMode[]).map((mode) => (
                <button key={mode} className={splitMode === mode ? "active" : ""} type="button" onClick={() => setSplitMode(mode)}>
                  {modeLabel(mode)}
                </button>
              ))}
            </div>
          </div>

          <div className="member-grid" aria-label="Nguoi tham gia">
            {members.map((member) => {
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

          {splitMode !== "equal" && (
            <div className="split-grid" aria-label="Gia tri chia">
              {participantIds.map((memberId) => {
                const member = findMember(members, memberId);

                return (
                  <label className="mini-field" key={memberId}>
                    <span>{member.name}</span>
                    <input
                      inputMode="decimal"
                      value={splitValues[memberId] ?? ""}
                      placeholder={splitMode === "percent" ? "%" : "phan"}
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

        <section className="settlement-panel" aria-label="Thanh toan de xuat">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Nhom {members.length} nguoi</span>
              <h2>Ai tra ai</h2>
            </div>
            <Users size={22} />
          </div>

          <div className="settlement-list">
            {settlements.map((settlement) => (
              <div className="settlement-item" key={`${settlement.fromUserId}-${settlement.toUserId}-${settlement.amountMinor}`}>
                <Avatar member={findMember(members, settlement.fromUserId)} />
                <div className="settlement-copy">
                  <strong>
                    {findMember(members, settlement.fromUserId).name} tra {findMember(members, settlement.toUserId).name}
                  </strong>
                  <span>{formatMoney(Number(settlement.amountMinor), settlement.currency)}</span>
                </div>
                <ArrowRightLeft size={18} />
              </div>
            ))}
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

          <div className="member-manager">
            <div className="section-heading compact-heading">
              <h2>Thanh vien</h2>
              <span>{currentTripRole}</span>
            </div>

            <form className="member-add-form" onSubmit={handleAddMember}>
              <input
                value={newMemberEmail}
                onChange={(event) => setNewMemberEmail(event.target.value)}
                placeholder="Email dang nhap"
                disabled={!canManageTripMembers}
              />
              <input
                value={newMemberName}
                onChange={(event) => setNewMemberName(event.target.value)}
                placeholder="Ten hien thi"
                disabled={!canManageTripMembers}
              />
              <select value={newMemberRole} onChange={(event) => setNewMemberRole(event.target.value as ApiTripRole)} disabled={!canManageTripMembers}>
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="owner">owner</option>
              </select>
              <button type="submit" disabled={!canManageTripMembers} title="Them thanh vien" aria-label="Them thanh vien">
                <Plus size={18} />
              </button>
            </form>

            <div className="trip-member-list">
              {members.map((member) => (
                <div className="trip-member-row" key={member.id}>
                  <Avatar member={member} />
                  <span>{member.name}</span>
                  <select
                    value={member.role}
                    onChange={(event) => handleRoleChange(member.id, event.target.value as ApiTripRole)}
                    disabled={!canManageTripMembers || member.id === currentUser.id}
                  >
                    <option value="viewer">viewer</option>
                    <option value="editor">editor</option>
                    <option value="owner">owner</option>
                  </select>
                  <button
                    type="button"
                    title="Xoa thanh vien"
                    aria-label="Xoa thanh vien"
                    disabled={!canManageTripMembers || member.id === currentUser.id}
                    onClick={() => handleRemoveMember(member.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          </section>
          </section>

          <section className="expense-list" aria-label="Chi phi gan day">
            <div className="section-heading">
              <h2>Chi phi gan day</h2>
              <span>{expenses.length} khoan</span>
            </div>
            {expenses.map((expense) => (
              <article className="expense-item" key={expense.id}>
                <div className="expense-icon">{categoryIcon(expense.category)}</div>
                <div>
                  <h3>{expense.title}</h3>
                  <p>
                    {expense.createdAt} - {findMember(members, expense.paidByUserId).name} tra - {participantCount(expense)} nguoi
                  </p>
                </div>
                <strong>{formatMoney(Number(expense.money.amount), expense.money.currency)}</strong>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function RouteIntelligence({
  currentUserId,
  destination,
  isPlanningRoute,
  isSharingLocation,
  isUsingCurrentLocation,
  locationShareStatus,
  memberLocations,
  onDestinationChange,
  onOriginChange,
  onPlanRoute,
  onPlanRouteFromCurrentLocation,
  onStartSharingLocation,
  onStopSharingLocation,
  origin,
  originCoordinate,
  routePlan,
}: {
  currentUserId: string;
  destination: string;
  isPlanningRoute: boolean;
  isSharingLocation: boolean;
  isUsingCurrentLocation: boolean;
  locationShareStatus: LocationShareStatus;
  memberLocations: ApiMemberLocation[];
  onDestinationChange: (value: string) => void;
  onOriginChange: (value: string) => void;
  onPlanRoute: (event: FormEvent<HTMLFormElement>) => void;
  onPlanRouteFromCurrentLocation: () => void;
  onStartSharingLocation: () => void;
  onStopSharingLocation: () => void;
  origin: string;
  originCoordinate: ApiGeoPoint | null;
  routePlan: ApiRoutePlan;
}) {
  return (
    <section className="route-intel" aria-label="Lo trinh va thoi tiet">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Smart Routing</span>
          <h2>{routePlan.title}</h2>
        </div>
        <Map size={22} />
      </div>

      <form className="route-builder" onSubmit={onPlanRoute}>
        <label>
          <span>Diem di</span>
          <input value={origin} onChange={(event) => onOriginChange(event.target.value)} placeholder="Diem xuat phat" />
        </label>
        <label>
          <span>Diem den</span>
          <input value={destination} onChange={(event) => onDestinationChange(event.target.value)} placeholder="Diem den" />
        </label>
        {originCoordinate && <p className="route-gps-note">Dang dung GPS lam diem xuat phat.</p>}
        <div className="route-builder-actions">
          <button className="location-route-button" type="button" disabled={isPlanningRoute || isUsingCurrentLocation} onClick={onPlanRouteFromCurrentLocation}>
            <MapPin size={17} />
            <span>{isUsingCurrentLocation ? "Dang lay GPS..." : "Tu vi tri cua toi"}</span>
          </button>
          <button type="submit" disabled={isPlanningRoute || isUsingCurrentLocation}>
            <Navigation size={17} />
            <span>{isPlanningRoute ? "Dang ve..." : "Ve tuyen"}</span>
          </button>
        </div>
      </form>

      <div className="route-intel-grid">
        <div className="route-map-panel">
          <OpenStreetRouteMap currentUserId={currentUserId} memberLocations={memberLocations} routePlan={routePlan} />
          <div className="route-map-head">
            <span>
              {routePlan.origin} {" -> "} {routePlan.destination}
            </span>
            <strong>{routePlan.offlinePack.mapTilesMb} MB offline</strong>
          </div>
          <div className="route-alerts">
            <MiniMetric label="Diem dung" value={`${routePlan.summary.suggestedStops}`} />
            <MiniMetric label="Thoi tiet" value={`${routePlan.summary.weatherAlerts}`} />
            <MiniMetric label="Cua khau" value={`${routePlan.summary.borderAlerts}`} />
          </div>
        </div>

        <div className="route-side-stack">
          <div className="next-stop-card">
            <span className="eyebrow">Can chu y tiep theo</span>
            <strong>{routePlan.summary.nextCriticalStop ?? "Khong co canh bao"}</strong>
            <p>{routePlan.waypoints.find((waypoint) => waypoint.name === routePlan.summary.nextCriticalStop)?.weather.advisory ?? "Chang hien tai on dinh."}</p>
          </div>

          <div className="group-location-card">
            <div className="group-location-head">
              <div>
                <span className="eyebrow">GPS nhom</span>
                <strong>{memberLocations.length} dang chia se</strong>
              </div>
              <button
                className={isSharingLocation ? "location-share-button active" : "location-share-button"}
                type="button"
                onClick={isSharingLocation ? onStopSharingLocation : onStartSharingLocation}
              >
                <Navigation size={16} />
                <span>{isSharingLocation ? "Tat" : "Bat"}</span>
              </button>
            </div>

            {locationShareStatus !== "idle" && <p className={`location-share-note ${locationShareStatus}`}>{locationShareStatusText(locationShareStatus)}</p>}

            <div className="group-location-list">
              {memberLocations.length ? (
                memberLocations.map((location) => (
                  <div className="group-location-row" key={location.userId}>
                    <span>{createLocationInitials(location.displayName || location.userId)}</span>
                    <div>
                      <strong>{location.userId === currentUserId ? "Ban" : location.displayName || "Thanh vien"}</strong>
                      <small>{formatLocationTime(location.sharedAt)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <p>Chua ai bat chia se GPS.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="waypoint-list">
        {routePlan.waypoints.map((waypoint) => (
          <WaypointCard key={waypoint.id} waypoint={waypoint} />
        ))}
      </div>
    </section>
  );
}

function OpenStreetRouteMap({
  currentUserId,
  memberLocations,
  routePlan,
}: {
  currentUserId: string;
  memberLocations: ApiMemberLocation[];
  routePlan: ApiRoutePlan;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const leafletModuleRef = useRef<typeof import("leaflet") | null>(null);
  const locationWatchIdRef = useRef<number | null>(null);
  const userMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const userAccuracyRef = useRef<import("leaflet").Circle | null>(null);
  const memberLocationLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [status, setStatus] = useState<LeafletMapStatus>("loading");
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [locationStatus, setLocationStatus] = useState<LocationWatchStatus>("idle");

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

  const updateUserPosition = useCallback(async (position: GeolocationPosition) => {
    const map = mapInstanceRef.current;

    if (!map) {
      return;
    }

    const leaflet = leafletModuleRef.current ?? (await import("leaflet"));
    leafletModuleRef.current = leaflet;

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
            html: "<span></span>",
            iconAnchor: [10, 10],
            iconSize: [20, 20],
          }),
          title: "Vi tri cua ban",
        })
        .bindPopup("Vi tri cua ban")
        .addTo(map);
    } else {
      userMarkerRef.current.setLatLng(latLng);
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
      clearMemberLocationLayer();

      if (!memberLocations.length) {
        return;
      }

      const layer = leaflet.layerGroup();

      for (const location of memberLocations) {
        const latLng = leaflet.latLng(location.latitude, location.longitude);
        const label = location.userId === currentUserId ? "Ban" : location.displayName || "Thanh vien";
        const initials = createLocationInitials(label);

        leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              className: location.userId === currentUserId ? "member-location-marker self" : "member-location-marker",
              html: `<span>${escapeHtml(initials)}</span>`,
              iconAnchor: [16, 16],
              iconSize: [32, 32],
            }),
            title: label,
          })
          .bindPopup(`<strong>${escapeHtml(label)}</strong><br />Cap nhat ${escapeHtml(formatLocationTime(location.sharedAt))}`)
          .addTo(layer);

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
    });

    return () => {
      cancelled = true;
    };
  }, [clearMemberLocationLayer, currentUserId, memberLocations, status]);

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
    };
  }, [clearMemberLocationLayer, clearUserLocationLayer, routePlan]);

  useEffect(() => {
    return () => {
      if (locationWatchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current);
      }
    };
  }, []);

  return (
    <div className="osm-map-shell">
      <div className="osm-map-canvas" ref={mapElementRef} />
      {status === "ready" && (
        <div className="osm-map-controls">
          <button
            className={isFollowingUser ? "map-follow-button active" : "map-follow-button"}
            type="button"
            onClick={isFollowingUser ? stopFollowingUser : startFollowingUser}
          >
            <Navigation size={15} />
            <span>{isFollowingUser ? "Dang theo GPS" : "Theo GPS"}</span>
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
            {waypoint.weather.tempC}C, mua {waypoint.weather.rainChance}%, gio {waypoint.weather.windKph} km/h
            {typeof waypoint.weather.precipitationMm === "number" ? `, luong mua ${waypoint.weather.precipitationMm} mm` : ""}
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
        {waypoint.borderChecklist.length > 0 && <span className="stop-pill required">Giay to: {waypoint.borderChecklist.length}</span>}
      </div>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

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

function Avatar({ member }: { member: Member }) {
  return <span className="avatar">{member.initials}</span>;
}

function modeLabel(mode: SplitMode): string {
  if (mode === "percent") {
    return "%";
  }

  if (mode === "share") {
    return "Phan";
  }

  return "Deu";
}

function formatSyncTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function liveEventLabel(type: ApiTripLiveEvent["type"]): string {
  if (type === "expense_created") {
    return "co chi phi moi";
  }

  if (type === "member_changed") {
    return "nhom vua doi";
  }

  if (type === "location_updated") {
    return "GPS nhom vua cap nhat";
  }

  if (type === "location_stopped") {
    return "co nguoi tat GPS";
  }

  return "tuyen vua doi";
}

function tabButtonClass(activeTab: MobileTab, tab: MobileTab): string {
  return activeTab === tab ? "active" : "";
}

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

function participantCount(expense: ApiExpense): number {
  if (expense.split.type === "equal") {
    return expense.split.userIds.length;
  }

  return expense.split.shares.length;
}

function mapTripMember(member: ApiTripMember): TripMemberView {
  return {
    id: member.userId,
    name: member.displayName,
    initials: createInitials(member.displayName),
    role: member.role,
  };
}

function createInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .padEnd(2, "?");
}

function createLocationInitials(name: string): string {
  return createInitials(name).slice(0, 2);
}

function formatLocationTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "vua xong";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function findMember(members: TripMemberView[], memberId: string): Member {
  return members.find((member) => member.id === memberId) ?? { id: memberId, name: "Unknown", initials: "??" };
}

function enqueueExpense(item: OfflineExpenseQueueItem) {
  const current = readQueuedExpenses();

  if (current.some((expense) => expense.id === item.id)) {
    return;
  }

  writeQueuedExpenses([...current, item]);
}

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

function writeQueuedExpenses(items: OfflineExpenseQueueItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(expenseQueueCacheKey(), JSON.stringify(items));
}

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

function shouldQueueExpense(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /failed to fetch|network|load failed|fetch/i.test(error.message);
}

function createClientMutationId(): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
  const id = cryptoApi?.randomUUID ? cryptoApi.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `expense_${id}`;
}

function isQueuedExpense(value: unknown): value is OfflineExpenseQueueItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<OfflineExpenseQueueItem>;
  return typeof item.id === "string" && typeof item.tripId === "string" && typeof item.createdAt === "string" && isExpensePayload(item.payload);
}

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

function expenseQueueCacheKey(): string {
  return "trail-ledger-offline-expense-queue";
}

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
    return isCachedRoutePlan(parsed.routePlan) ? parsed.routePlan : null;
  } catch {
    return null;
  }
}

function writeCachedRoutePlan(routePlan: ApiRoutePlan, activeTripId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    routePlanCacheKey(activeTripId),
    JSON.stringify({
      cachedAt: new Date().toISOString(),
      routePlan,
    }),
  );
}

function routePlanCacheKey(activeTripId: string): string {
  return `trail-ledger-route-plan-v2:${activeTripId}`;
}

function selectedTripCacheKey(): string {
  return "trail-ledger-selected-trip-v2";
}

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

function getCurrentBrowserPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        reject(new Error(error.code === error.PERMISSION_DENIED ? "Can cho phep quyen vi tri de ve tu GPS" : "Khong lay duoc vi tri hien tai"));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    );
  });
}

function categoryIcon(category: string) {
  const item = categories.find((entry) => entry.id === category) ?? categories[0]!;
  const Icon = item.icon;
  return <Icon size={18} />;
}

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

function weatherSourceLabel(source: NonNullable<ApiRouteWaypoint["weather"]["source"]>): string {
  if (source === "open-meteo") {
    return "Open-Meteo live";
  }

  if (source === "fallback") {
    return "Du phong";
  }

  return "Du lieu mau";
}

type LeafletMapStatus = "loading" | "ready" | "error";
type LocationWatchStatus = "idle" | "searching" | "watching" | "denied" | "unavailable";
type LocationShareStatus = "idle" | "starting" | "sharing" | "denied" | "unavailable" | "error";

function leafletMapStatusText(status: LeafletMapStatus): string {
  if (status === "error") {
    return "Khong tai duoc ban do";
  }

  return "Dang tai OpenStreetMap";
}

function locationWatchStatusText(status: LocationWatchStatus): string {
  if (status === "searching") {
    return "Dang tim vi tri GPS";
  }

  if (status === "watching") {
    return "Ban do dang bam theo ban";
  }

  if (status === "denied") {
    return "Can cho phep quyen vi tri";
  }

  if (status === "unavailable") {
    return "Khong lay duoc vi tri";
  }

  return "";
}

function locationShareStatusText(status: LocationShareStatus): string {
  if (status === "starting") {
    return "Dang xin GPS de chia se cho nhom";
  }

  if (status === "sharing") {
    return "Dang chia se vi tri moi 15 giay";
  }

  if (status === "denied") {
    return "Can cho phep quyen vi tri";
  }

  if (status === "unavailable") {
    return "Khong lay duoc GPS tren may nay";
  }

  if (status === "error") {
    return "Chua gui duoc vi tri, se thu lai";
  }

  return "";
}
