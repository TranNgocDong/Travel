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
  MessageCircle,
  Moon,
  Navigation,
  Plus,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sun,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addTripMember,
  createExpense,
  createTrip,
  defaultTripId,
  fetchExpenses,
  fetchMe,
  fetchRoutePlan,
  fetchTripMessages,
  fetchTripLocations,
  fetchTripPresence,
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
  sendTripMessage,
  subscribeToTripEvents,
  stopSharingMyLocation,
  updateTripMember,
  type ApiBalance,
  type ApiCreateExpensePayload,
  type ApiExpense,
  type ApiExpenseSplit,
  type ApiGeoPoint,
  type ApiMemberLocation,
  type ApiPresenceUser,
  type ApiRoutePlan,
  type ApiRouteStopKind,
  type ApiRouteWaypoint,
  type ApiSettlement,
  type ApiTrip,
  type ApiTripLiveEvent,
  type ApiTripMember,
  type ApiTripMessage,
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

type PresenceNotice = {
  id: string;
  message: string;
  tone: "join" | "leave" | "message";
};

const categories = [
  { id: "fuel", label: "Xăng", icon: Fuel },
  { id: "food", label: "Ăn uống", icon: ReceiptText },
  { id: "hotel", label: "Nghỉ ngơi", icon: Bike },
  { id: "border", label: "Cửa khẩu", icon: ShieldCheck },
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
  const [presenceUsers, setPresenceUsers] = useState<ApiPresenceUser[]>([]);
  const [presenceNotice, setPresenceNotice] = useState<PresenceNotice | null>(null);
  const [chatMessages, setChatMessages] = useState<ApiTripMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
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
  const chatMessageListRef = useRef<HTMLDivElement | null>(null);

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
        setPresenceUsers([]);
        setChatMessages([]);
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

      const [nextMembers, nextExpenses, result, nextRoutePlan, nextLocations, nextPresence, nextMessages] = await Promise.all([
        fetchTripMembers(selectedTripId),
        fetchExpenses(selectedTripId),
        fetchSettlementResult(selectedTripId),
        fetchRoutePlan(selectedTripId),
        fetchTripLocations(selectedTripId).catch(() => []),
        fetchTripPresence(selectedTripId).catch(() => []),
        fetchTripMessages(selectedTripId).catch(() => []),
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
      setPresenceUsers(nextPresence);
      setChatMessages(nextMessages);
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
  }, [activeTrip?.id, currentUser, isChatOpen, loadTripData, loadTripLocations, loadTripMessages, loadTripPresence]);

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

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("trail-ledger-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  function handleToggleChat() {
    const nextOpen = !isChatOpen;
    setIsChatOpen(nextOpen);

    if (nextOpen) {
      setUnreadChatCount(0);
      setChatError(null);

      if (activeTrip?.id) {
        void loadTripMessages(activeTrip.id);
      }
    }
  }

  async function handleSendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeTrip?.id || !currentUser || isSendingMessage) {
      return;
    }

    const nextBody = chatDraft.trim();

    if (!nextBody) {
      return;
    }

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
        setApiError("Đã lưu tạm chi phí trong máy. Có mạng lại sẽ tự động đồng bộ.");
      } else {
        setApiError(error instanceof Error ? error.message : "Không lưu được chi phí");
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
      setApiError(error instanceof Error ? error.message : "Đăng nhập thất bại");
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
      setApiError(error instanceof Error ? error.message : "Đăng nhập Google thất bại");
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
        origin: routeOriginCoordinate ? routeOrigin.trim() || "Vị trí của bạn" : routeOrigin.trim(),
        destination: routeDestination.trim(),
        ...(routeOriginCoordinate ? { originCoordinate: routeOriginCoordinate } : {}),
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không vẽ được tuyến");
    } finally {
      setIsPlanningRoute(false);
    }
  }

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
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không lấy được vị trí hiện tại");
    } finally {
      setIsUsingCurrentLocation(false);
      setIsPlanningRoute(false);
    }
  }

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

      const nextRoutePlan = await planRoute({
        origin: "Vị trí của tôi",
        destination: destinationName,
        originCoordinate,
        destinationCoordinate,
      }, selectedTripId);
      applyRoutePlan(nextRoutePlan, { tripId: selectedTripId });
      setActiveTab("route");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không vẽ được đường tới thành viên");
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
    setPresenceUsers([]);
    setPresenceNotice(null);
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
      setApiError(error instanceof Error ? error.message : "Không tạo được chuyến đi");
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
    setPresenceUsers([]);
    setPresenceNotice(null);
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
      setApiError(error instanceof Error ? error.message : "Không thêm được thành viên");
    }
  }

  async function handleRoleChange(memberId: string, role: ApiTripRole) {
    setApiError(null);

    try {
      await updateTripMember(memberId, { role }, selectedTripId);
      await loadTripData();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không đổi được quyền");
    }
  }

  async function handleRemoveMember(memberId: string) {
    setApiError(null);

    try {
      await removeTripMember(memberId, selectedTripId);
      await loadTripData();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Không xóa được thành viên");
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
            <span>Không gian chuyến đi bảo mật</span>
          </div>
          <button className="icon-button" type="button" title="Đổi giao diện" aria-label="Đổi giao diện" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>

        <form className="expense-panel auth-panel" onSubmit={handleLogin}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Bảo mật</span>
              <h1>Đăng nhập</h1>
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
            <span>Mật khẩu</span>
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="Mật khẩu Firebase"
            />
          </label>

          <button className="auth-submit" type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? "Đang vào..." : "Đăng nhập"}
          </button>

          <button className="google-submit" type="button" disabled={isLoggingIn} onClick={handleGoogleLogin}>
            <span aria-hidden="true">G</span>
            Đăng nhập với Google
          </button>

          <div className="rate-note">
            <ShieldCheck size={16} />
            <span>Email/mật khẩu cần tạo user trước. Google chỉ cần bật provider trong Firebase Console.</span>
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
                {trip.title}
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
          <span>{isUsingOfflineRoute ? "Đang xem offline" : offlineReady ? "Đã lưu offline" : "Chưa lưu offline"}</span>
        </div>
      </section>

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

      <nav className="mobile-tabs" aria-label="Chuyển màn hình">
        <button className={tabButtonClass(activeTab, "route")} type="button" onClick={() => setActiveTab("route")}>
          <Map size={17} />
          <span>Bản đồ</span>
        </button>
        <button className={tabButtonClass(activeTab, "expenses")} type="button" onClick={() => setActiveTab("expenses")}>
          <WalletCards size={17} />
          <span>Chi phí</span>
        </button>
        <button className={tabButtonClass(activeTab, "group")} type="button" onClick={() => setActiveTab("group")}>
          <Users size={17} />
          <span>Nhóm</span>
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
            ? "Đang cập nhật dữ liệu nhóm..."
            : isLiveSyncConnected
              ? lastLiveSyncEvent
                ? `Live sync: ${liveEventLabel(lastLiveSyncEvent.type)}`
                : "Live sync đang bật"
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

      {!trips.length && !isLoading && (
        <section className="empty-state" aria-label="Bắt đầu chuyến đi">
          <Map size={24} />
          <div>
            <h2>Chưa có chuyến đi</h2>
            <p>Tạo chuyến đầu tiên, sau đó thêm thành viên, vẽ tuyến và ghi chi phí của bạn.</p>
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
          onPlanRouteToMember={handlePlanRouteToMember}
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
              <span className="eyebrow">Khoản mới</span>
              <h2>Ghi chi phí</h2>
            </div>
            <button className="primary-icon" type="submit" title="Lưu chi phí" aria-label="Lưu chi phí" disabled={isSaving || !members.length}>
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

          <div className="select-row">
            <label className="field">
              <span>Người trả</span>
              <select value={payerId} onChange={(event) => setPayerId(event.target.value)}>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="mode-switch" aria-label="Kiểu chia">
              {(["equal", "percent", "share"] satisfies SplitMode[]).map((mode) => (
                <button key={mode} className={splitMode === mode ? "active" : ""} type="button" onClick={() => setSplitMode(mode)}>
                  {modeLabel(mode)}
                </button>
              ))}
            </div>
          </div>

          <div className="member-grid" aria-label="Người tham gia">
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

        <div className="group-stack">
          <PresencePanel currentUserId={currentUser.id} presenceUsers={presenceUsers} />

          <SettlementPanel balances={balances} members={members} settlements={settlements} />

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

function PresencePanel({ currentUserId, presenceUsers }: { currentUserId: string; presenceUsers: ApiPresenceUser[] }) {
  return (
    <section className="presence-panel" aria-label="Hiện diện trong phòng">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Hiện diện</span>
          <h2>{presenceUsers.length} đang trong phòng</h2>
        </div>
        <Users size={22} />
      </div>

      <div className="presence-list">
        {presenceUsers.length ? (
          presenceUsers.map((user) => (
            <div className={user.userId === currentUserId ? "presence-row self" : "presence-row"} key={user.userId}>
              <Avatar member={{ id: user.userId, name: user.displayName, initials: createInitials(user.displayName) }} />
              <div>
                <strong>{user.userId === currentUserId ? "Bạn" : user.displayName}</strong>
                <span>
                  Online từ {formatLocationTime(user.onlineSince)}
                  {user.connectionCount > 1 ? ` - ${user.connectionCount} thiết bị` : ""}
                </span>
              </div>
              <i aria-label="Đang online" />
            </div>
          ))
        ) : (
          <p>Chưa thấy ai trong phòng. Khi có người mở chuyến đi, danh sách sẽ tự hiện.</p>
        )}
      </div>
    </section>
  );
}

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
  return (
    <section className="member-manager-panel" aria-label="Quản lý thành viên">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Quản lý nhóm</span>
          <h2>Thành viên</h2>
        </div>
        <span className="role-pill">{currentTripRole}</span>
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
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
          <option value="owner">owner</option>
        </select>
        <button type="submit" disabled={!canManageTripMembers} title="Thêm thành viên" aria-label="Thêm thành viên">
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
              onChange={(event) => onRoleChange(member.id, event.target.value as ApiTripRole)}
              disabled={!canManageTripMembers || member.id === currentUserId}
            >
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="owner">owner</option>
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
    </section>
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
  onPlanRouteToMember,
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
  onPlanRouteToMember: (location: ApiMemberLocation) => void;
  onStartSharingLocation: () => void;
  onStopSharingLocation: () => void;
  origin: string;
  originCoordinate: ApiGeoPoint | null;
  routePlan: ApiRoutePlan;
}) {
  return (
    <section className="route-intel" aria-label="Lộ trình và thời tiết">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Smart Routing</span>
          <h2>{routePlan.title}</h2>
        </div>
        <Map size={22} />
      </div>

      <form className="route-builder" onSubmit={onPlanRoute}>
        <label>
          <span>Điểm đi</span>
          <input value={origin} onChange={(event) => onOriginChange(event.target.value)} placeholder="Điểm xuất phát" />
        </label>
        <label>
          <span>Điểm đến</span>
          <input value={destination} onChange={(event) => onDestinationChange(event.target.value)} placeholder="Điểm đến" />
        </label>
        {originCoordinate && <p className="route-gps-note">Đang dùng GPS làm điểm xuất phát.</p>}
        <div className="route-builder-actions">
          <button className="location-route-button" type="button" disabled={isPlanningRoute || isUsingCurrentLocation} onClick={onPlanRouteFromCurrentLocation}>
            <MapPin size={17} />
            <span>{isUsingCurrentLocation ? "Đang lấy GPS..." : "Từ vị trí của tôi"}</span>
          </button>
          <button type="submit" disabled={isPlanningRoute || isUsingCurrentLocation}>
            <Navigation size={17} />
            <span>{isPlanningRoute ? "Đang vẽ..." : "Vẽ tuyến"}</span>
          </button>
        </div>
      </form>

      <div className="route-intel-grid">
        <div className="route-map-panel">
          <OpenStreetRouteMap currentUserId={currentUserId} memberLocations={memberLocations} onPlanRouteToMember={onPlanRouteToMember} routePlan={routePlan} />
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
        </div>

        <div className="route-side-stack">
          <div className="next-stop-card">
            <span className="eyebrow">Cần chú ý tiếp theo</span>
            <strong>{routePlan.summary.nextCriticalStop ?? "Không có cảnh báo"}</strong>
            <p>{routePlan.waypoints.find((waypoint) => waypoint.name === routePlan.summary.nextCriticalStop)?.weather.advisory ?? "Chặng hiện tại ổn định."}</p>
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
  onPlanRouteToMember,
  routePlan,
}: {
  currentUserId: string;
  memberLocations: ApiMemberLocation[];
  onPlanRouteToMember: (location: ApiMemberLocation) => void;
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
          title: "Vị trí của bạn",
        })
        .bindPopup("Vị trí của bạn")
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
        const label = location.userId === currentUserId ? "Bạn" : location.displayName || "Thành viên";
        const initials = createLocationInitials(label);

        const marker = leaflet
          .marker(latLng, {
            icon: leaflet.divIcon({
              className: location.userId === currentUserId ? "member-location-marker self" : "member-location-marker",
              html: `<span>${escapeHtml(initials)}</span>`,
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
  }, [clearMemberLocationLayer, currentUserId, memberLocations, onPlanRouteToMember, status]);

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
    return "Phần";
  }

  return "Đều";
}

function formatSyncTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

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

function liveEventLabel(type: ApiTripLiveEvent["type"]): string {
  if (type === "expense_created") {
    return "có chi phí mới";
  }

  if (type === "member_changed") {
    return "nhóm vừa đổi";
  }

  if (type === "message_created") {
    return "có tin nhắn mới";
  }

  if (type === "location_updated") {
    return "GPS nhóm vừa cập nhật";
  }

  if (type === "location_stopped") {
    return "có người tắt GPS";
  }

  return "tuyến vừa đổi";
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
    return "Dự phòng";
  }

  return "Dữ liệu mẫu";
}

type LeafletMapStatus = "loading" | "ready" | "error";
type LocationWatchStatus = "idle" | "searching" | "watching" | "denied" | "unavailable";
type LocationShareStatus = "idle" | "starting" | "sharing" | "denied" | "unavailable" | "error";

function leafletMapStatusText(status: LeafletMapStatus): string {
  if (status === "error") {
    return "Không tải được bản đồ";
  }

  return "Đang tải OpenStreetMap";
}

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
