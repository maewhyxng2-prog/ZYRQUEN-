import { useCallback, useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AppShell } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { CommandPalette } from './components/CommandPalette';
import { HomeView } from './components/HomeView';
import { MemoryWorkflowsView } from './components/MemoryWorkflowsView';
import { SettingsView } from './components/SettingsView';
import { WorkspaceView } from './components/WorkspaceView';
import { apiRequest, ApiError, streamConversationMessage } from './lib/api';
import type {
  AppScreen,
  AuthStatus,
  ConversationSummary,
  HomeSummary,
  MessageItem,
  ModelVariantId,
  ReasoningMode,
  SettingsTab,
  User,
} from './types';

function readRouteFromUrl(): {
  screen: AppScreen;
  conversationId: string | null;
  settingsTab: SettingsTab;
} {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const cid = params.get('cid');
  const tab = params.get('tab');

  const screen: AppScreen =
    view === 'workspace' || view === 'memory' || view === 'settings' ? view : 'home';
  const settingsTab: SettingsTab =
    tab === 'developer' || tab === 'admin' ? tab : 'account';

  return { screen, conversationId: cid || null, settingsTab };
}

function buildUrl(
  screen: AppScreen,
  conversationId: string | null,
  settingsTab: SettingsTab
): string {
  const params = new URLSearchParams();
  if (screen !== 'home') {
    params.set('view', screen);
  }
  if (screen === 'workspace' && conversationId) {
    params.set('cid', conversationId);
  }
  if (screen === 'settings' && settingsTab !== 'account') {
    params.set('tab', settingsTab);
  }
  const qs = params.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

export default function App() {
  const initialRoute = readRouteFromUrl();

  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [nativeReady, setNativeReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const [screen, setScreen] = useState<AppScreen>(initialRoute.screen);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialRoute.settingsTab);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialRoute.conversationId
  );

  const [homeSummary, setHomeSummary] = useState<HomeSummary | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeTitle, setActiveTitle] = useState('เซสชันใหม่');
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<{
    content: string;
    mode: ReasoningMode;
    attachment?: string;
    modelVariant?: ModelVariantId;
  } | null>(null);

  const [defaultMode, setDefaultMode] = useState<ReasoningMode>('auto');
  const [selectedModelVariant, setSelectedModelVariant] =
    useState<ModelVariantId>('zyrquen-omega-v1');
  const [autoExpandTrace, setAutoExpandTrace] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const skipNextLoadCidRef = useRef<string | null>(null);

  const pushRoute = useCallback(
    (nextScreen: AppScreen, nextCid: string | null = null, nextTab: SettingsTab = 'account') => {
      const targetUrl = buildUrl(nextScreen, nextCid, nextTab);
      if (window.location.pathname + window.location.search !== targetUrl) {
        window.history.pushState(
          { screen: nextScreen, conversationId: nextCid, settingsTab: nextTab },
          '',
          targetUrl
        );
      }
      setScreen(nextScreen);
      setActiveConversationId(nextCid);
      setSettingsTab(nextTab);
    },
    []
  );

  useEffect(() => {
    const onPopState = () => {
      const parsed = readRouteFromUrl();
      setScreen(parsed.screen);
      setActiveConversationId(parsed.conversationId);
      setSettingsTab(parsed.settingsTab);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const bootstrapAuthAndHealth = useCallback(async () => {
    try {
      const [status, health, meRes] = await Promise.all([
        apiRequest<AuthStatus>('/api/auth/status'),
        apiRequest<{ ok: boolean; nativeCore: string }>('/api/health').catch(() => ({
          ok: false,
          nativeCore: 'offline',
        })),
        apiRequest<{ user: User }>('/api/auth/me').catch(() => null),
      ]);
      setAuthStatus(status);
      setNativeReady(health.ok && health.nativeCore === 'ready');
      if (meRes?.user) {
        setUser(meRes.user);
        setToken((prev) => prev || '__cookie__');
      }
    } catch {
      setAuthStatus({ initialized: true, userCount: 0, envPasscodeConfigured: false });
      setNativeReady(false);
    }
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void bootstrapAuthAndHealth();
    };
    const onOffline = () => {
      setIsOnline(false);
      setNativeReady(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [bootstrapAuthAndHealth]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active && isOnline) void bootstrapAuthAndHealth();
    });
    return () => {
      active = false;
    };
  }, [bootstrapAuthAndHealth, isOnline]);

  const loadHomeAndConversations = useCallback(async () => {
    if (!token) return;
    await Promise.resolve();
    setHomeLoading(true);
    setHomeError(null);
    try {
      const [summary, convList] = await Promise.all([
        apiRequest<HomeSummary>('/api/home', { token }),
        apiRequest<{ conversations: ConversationSummary[] }>('/api/conversations', { token }),
      ]);
      setHomeSummary(summary);
      setConversations(convList.conversations);
    } catch (err) {
      setHomeError(err instanceof ApiError ? err.message : 'Unable to load workspace summary');
    } finally {
      setHomeLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || !user) return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadHomeAndConversations();
    });
    return () => {
      active = false;
    };
  }, [loadHomeAndConversations, token, user]);

  const loadConversationThread = useCallback(
    async (cid: string) => {
      if (!token) return;
      await Promise.resolve();
      setLoadingThread(true);
      setWorkspaceError(null);
      try {
        const res = await apiRequest<{
          conversation: ConversationSummary;
          messages: MessageItem[];
        }>(`/api/conversations/${cid}`, { token });
        setActiveTitle(res.conversation.title);
        setMessages(res.messages);
      } catch (err) {
        setWorkspaceError(err instanceof ApiError ? err.message : 'Failed to load conversation');
      } finally {
        setLoadingThread(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!token || screen !== 'workspace' || !activeConversationId) return;
    if (skipNextLoadCidRef.current === activeConversationId) {
      skipNextLoadCidRef.current = null;
      return;
    }
    let active = true;
    const cid = activeConversationId;
    Promise.resolve().then(() => {
      if (active) void loadConversationThread(cid);
    });
    return () => {
      active = false;
    };
  }, [activeConversationId, loadConversationThread, screen, token]);

  async function handleStartPrompt(prompt: string, mode: ReasoningMode) {
    if (!token) return;
    setWorkspaceError(null);
    try {
      const created = await apiRequest<{ conversation: ConversationSummary }>('/api/conversations', {
        method: 'POST',
        token,
        body: { title: prompt.slice(0, 48), mode },
      });
      const cid = created.conversation.id;
      skipNextLoadCidRef.current = cid;
      setConversations((prev) => [
        { ...created.conversation, message_count: 0 },
        ...prev,
      ]);
      setActiveTitle(created.conversation.title);
      setMessages([]);
      pushRoute('workspace', cid, settingsTab);
      await sendMessageToConversation(cid, prompt, mode, undefined, selectedModelVariant);
    } catch (err) {
      setWorkspaceError(err instanceof ApiError ? err.message : 'Failed to start conversation');
    }
  }

  async function sendMessageToConversation(
    cid: string | null,
    content: string,
    mode: ReasoningMode,
    attachment?: string,
    modelVariant: ModelVariantId = selectedModelVariant
  ) {
    if (!token) return;
    setSending(true);
    setStreamingContent(null);
    setWorkspaceError(null);
    setLastFailedPrompt(null);

    try {
      let targetCid = cid;
      if (!targetCid) {
        const created = await apiRequest<{ conversation: ConversationSummary }>('/api/conversations', {
          method: 'POST',
          token,
          body: { title: content ? content.slice(0, 48) : 'Attached Context', mode },
        });
        targetCid = created.conversation.id;
        skipNextLoadCidRef.current = targetCid;
        setActiveTitle(created.conversation.title);
        pushRoute('workspace', targetCid, settingsTab);
      }

      const res = await streamConversationMessage<{
        title: string;
        user_message: MessageItem;
        assistant_message: MessageItem;
      }>(targetCid, {
        token,
        content,
        mode,
        attachment,
        modelVariant,
        onDelta: (partial) => setStreamingContent(partial),
      });

      setActiveTitle(res.title);
      setMessages((prev) => [...prev, res.user_message, res.assistant_message]);
      void loadHomeAndConversations();
    } catch (err) {
      setLastFailedPrompt({ content, mode, attachment, modelVariant });
      setWorkspaceError(err instanceof ApiError ? err.message : 'Native inference failed');
    } finally {
      setSending(false);
      setStreamingContent(null);
    }
  }

  const handleNewConversation = useCallback(() => {
    setActiveTitle('เซสชันใหม่');
    setMessages([]);
    setWorkspaceError(null);
    pushRoute('workspace', null, settingsTab);
  }, [pushRoute, settingsTab]);

  useEffect(() => {
    if (!token || !user) return;
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === '1') {
          e.preventDefault();
          pushRoute('home', null, settingsTab);
        } else if (e.key === '2') {
          e.preventDefault();
          pushRoute('workspace', activeConversationId, settingsTab);
        } else if (e.key === '3') {
          e.preventDefault();
          pushRoute('memory', null, settingsTab);
        } else if (e.key === '4') {
          e.preventDefault();
          pushRoute('settings', null, 'account');
        } else if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          handleNewConversation();
        }
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [activeConversationId, handleNewConversation, pushRoute, settingsTab, token, user]);

  async function handleDeleteConversation(cid: string) {
    if (!token) return;
    try {
      await apiRequest(`/api/conversations/${cid}`, { method: 'DELETE', token });
      setConversations((prev) => prev.filter((c) => c.id !== cid));
      if (activeConversationId === cid) {
        setActiveTitle('เซสชันใหม่');
        setMessages([]);
        pushRoute('workspace', null, settingsTab);
      }
      void loadHomeAndConversations();
    } catch (err) {
      setWorkspaceError(err instanceof ApiError ? err.message : 'ลบบทสนทนาไม่สำเร็จ');
    }
  }

  async function handleLogout() {
    if (token) {
      await apiRequest('/api/auth/logout', { method: 'POST', token }).catch(() => {});
    }
    setToken(null);
    setUser(null);
    setHomeSummary(null);
    setConversations([]);
    setMessages([]);
    pushRoute('home', null, 'account');
    void bootstrapAuthAndHealth();
  }

  if (!isOnline) {
    return (
      <div
        role="alert"
        className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#060A14] px-6 text-center text-slate-100"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-950/30 text-rose-300">
          <WifiOff className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-50">
          ต้องเชื่อมต่ออินเทอร์เน็ตเท่านั้น
        </h2>
        <p className="mt-2 max-w-sm text-sm text-slate-400">
          ZYRQUEN Ω∞ ไม่รองรับการทำงานแบบออฟไลน์ กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อเข้าถึงแกนสมองและฐานข้อมูลบนเซิร์ฟเวอร์
        </p>
        <button
          type="button"
          onClick={() => {
            const nowOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
            setIsOnline(nowOnline);
            if (nowOnline) void bootstrapAuthAndHealth();
          }}
          className="mt-6 flex h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-500"
        >
          ตรวจสอบการเชื่อมต่ออีกครั้ง
        </button>
      </div>
    );
  }

  if (!authStatus) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#060A14] text-sm text-slate-400">
        กำลังเริ่มต้นแกนสมอง ZYRQUEN Ω∞...
      </div>
    );
  }

  if (!token || !user) {
    return (
      <AuthGate
        authStatus={authStatus}
        onAuthenticated={(newToken, authedUser) => {
          setToken(newToken);
          setUser(authedUser);
          setAuthStatus((prev) => (prev ? { ...prev, initialized: true } : prev));
        }}
      />
    );
  }

  const screenTitle =
    screen === 'home'
      ? 'ZYRQUEN Ω∞'
      : screen === 'workspace'
        ? activeTitle
        : screen === 'memory'
          ? 'ความจำและเวิร์กโฟลว์'
          : settingsTab === 'developer'
            ? 'เครื่องมือนักพัฒนา'
            : settingsTab === 'admin'
              ? 'ผู้ดูแลระบบ'
              : 'ตั้งค่าบัญชี';

  return (
    <AppShell
      activeScreen={screen}
      screenTitle={screenTitle}
      user={user}
      showBackOnMobile={screen === 'workspace' || (screen === 'settings' && settingsTab !== 'account')}
      hideBottomBarOnMobile={screen === 'workspace'}
      onNavigate={(next) => {
        if (next === 'settings') {
          pushRoute('settings', null, 'account');
        } else if (next === 'workspace') {
          pushRoute('workspace', activeConversationId, settingsTab);
        } else {
          pushRoute(next, null, settingsTab);
        }
      }}
      onBack={() => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          pushRoute('home', null, 'account');
        }
      }}
      onOpenProfile={() => pushRoute('settings', null, 'account')}
      onOpenCommandPalette={() => setPaletteOpen(true)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${screen}-${screen === 'settings' ? settingsTab : ''}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          {screen === 'home' && (
            <HomeView
              user={user}
              homeSummary={homeSummary}
              nativeReady={nativeReady}
              loading={homeLoading}
              error={homeError}
              onStartPrompt={(prompt, mode) => void handleStartPrompt(prompt, mode)}
              onOpenConversation={(cid) => pushRoute('workspace', cid, settingsTab)}
              onNavigate={(next) => pushRoute(next, null, settingsTab)}
              onRetry={() => void loadHomeAndConversations()}
            />
          )}

          {screen === 'workspace' && (
            <WorkspaceView
              token={token}
              conversations={conversations}
              activeConversationId={activeConversationId}
              activeTitle={activeTitle}
              messages={messages}
              loadingThread={loadingThread}
              sending={sending}
              streamingContent={streamingContent}
              error={workspaceError}
              autoExpandTrace={autoExpandTrace}
              defaultMode={defaultMode}
              defaultModelVariant={selectedModelVariant}
              onSelectConversation={(cid) => pushRoute('workspace', cid, settingsTab)}
              onNewConversation={() => void handleNewConversation()}
              onDeleteConversation={(cid) => void handleDeleteConversation(cid)}
              onSendMessage={(content, mode, attachment, variant) =>
                sendMessageToConversation(
                  activeConversationId,
                  content,
                  mode,
                  attachment,
                  variant || selectedModelVariant
                )
              }
              onModelVariantChange={(variant) => setSelectedModelVariant(variant)}
              onRetryLast={
                lastFailedPrompt
                  ? () =>
                      void sendMessageToConversation(
                        activeConversationId,
                        lastFailedPrompt.content,
                        lastFailedPrompt.mode,
                        lastFailedPrompt.attachment,
                        lastFailedPrompt.modelVariant || selectedModelVariant
                      )
                  : undefined
              }
            />
          )}

          {screen === 'memory' && <MemoryWorkflowsView token={token} user={user} />}

          {screen === 'settings' && (
            <SettingsView
              token={token}
              user={user}
              activeTab={user.role !== 'admin' && settingsTab === 'admin' ? 'account' : settingsTab}
              autoExpandTrace={autoExpandTrace}
              defaultMode={defaultMode}
              onChangeTab={(nextTab) => pushRoute('settings', null, nextTab)}
              onUpdatePreferences={(prefs) => {
                if (prefs.autoExpandTrace !== undefined) setAutoExpandTrace(prefs.autoExpandTrace);
                if (prefs.defaultMode !== undefined) setDefaultMode(prefs.defaultMode);
              }}
              onLogout={() => void handleLogout()}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <CommandPalette
        open={paletteOpen}
        user={user}
        conversations={conversations}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(nextScreen, nextTab) => {
          if (nextScreen === 'settings') {
            pushRoute('settings', null, nextTab || 'account');
          } else if (nextScreen === 'workspace') {
            pushRoute('workspace', activeConversationId, settingsTab);
          } else {
            pushRoute(nextScreen, null, settingsTab);
          }
        }}
        onNewConversation={handleNewConversation}
        onOpenConversation={(cid) => pushRoute('workspace', cid, settingsTab)}
      />
    </AppShell>
  );
}
