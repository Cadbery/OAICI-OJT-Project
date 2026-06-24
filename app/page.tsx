"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import FormattedMessage from "../components/FormattedMessage";
import LogoutButton from "../components/LogoutButton";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

type BookmarkedMessage = {
  id: string;
  messageIdentity?: string;
  content: string;
  images?: string[];
  sourceType: "chat" | "roleplay";
  sourceTitle: string;
  moduleTitle: string;
  sessionIndex?: number;
  sessionNumber?: number;
  sessionTitle?: string;
  sessionLabel: string;
  createdAt: number;
};

type BookmarkSource = {
  sourceType: "chat" | "roleplay";
  sourceTitle: string;
  moduleTitle: string;
  sessionIndex?: number;
  sessionNumber?: number;
  sessionTitle?: string;
  sessionLabel: string;
};

type PendingBookmarkNavigation = {
  sourceType: "chat" | "roleplay";
  sourceTitle: string;
  moduleTitle: string;
  sessionIndex?: number;
  sessionNumber?: number;
  sessionTitle?: string;
  messageIdentity?: string;
  messageContent?: string;
};

type RecentChat = {
  id: string;
  title: string;
  context: string;
  updatedAt: number;
  sessionIndex?: number;
  sessionNumber?: number;
  // The actual Noodle dropdown title is the stable key used to reopen
  // the same session after the list order changes.
  sessionTitle?: string;
};

type SessionOption = {
  id: string;
  title: string;
  index: number;
  isActive: boolean;
  displayNumber?: number;
};

type RecommendedPrompt = {
  id: string;
  text: string;
  type: "review" | "practice";
};

type RecommendedPromptCard = {
  id: string;
  moduleTitle: string;
  prompts: RecommendedPrompt[];
};

type UserMessageMarker = {
  messageIndex: number;
  label: string;
};

type ActivityItem = {
  title: string;
  type: "quiz" | "roleplay" | "unknown";
  groupTitle: string;
  status?: string;
  attempts?: string;
};

type LearningOutcomesState = {
  outcomes: string[];
  isLoading: boolean;
  hasLoaded: boolean;
  error: string;
};

type QuizQuestion = {
  number: number;
  question: string;
  choices: string[];
};

type ActivityDetail = {
  title: string;
  type: "quiz" | "roleplay" | "unknown";
  groupTitle?: string;
  mode?: "all-at-once" | "one-at-a-time";
  questions?: QuizQuestion[];
  hasNext?: boolean;
  hasPrevious?: boolean;
  roleplayMessages?: ChatMessage[];
};

type SelectedActivityAnswer = {
  questionNumber: number;
  question: string;
  choice: string;
};

type ActivityResult = {
  title?: string;
  score?: string;
  summary?: string;
  text?: string;
  rawText?: string;
  lines?: string[];
};

type ActivityReviewQuestion = {
  number: number;
  score: string;
  question: string;
  recommendedAnswer: string;
  yourAnswer: string;
};

type ActivityReview = {
  title: string;
  questions: ActivityReviewQuestion[];
  rawLines?: string[];
};

const RECENT_CHATS_STORAGE_KEY = "walter_recent_week_chats";
const BOOKMARKS_STORAGE_KEY = "walter_ai_bookmarked_messages";
const PENDING_BOOKMARK_NAVIGATION_STORAGE_KEY =
  "walter_pending_bookmark_navigation";
const MAX_RECENT_CHATS = 50;

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function resizeComposerTextArea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return false;

  textarea.style.height = "auto";
  const nextHeight = Math.max(32, Math.min(textarea.scrollHeight, 128));
  textarea.style.height = `${nextHeight}px`;

  return textarea.scrollHeight > 36;
}

function createBookmarkId(
  source: BookmarkSource,
  messageIdentity: string,
  content: string,
  images: string[] = [],
) {
  const rawKey = [
    source.sourceType,
    normalizeText(source.moduleTitle).toLowerCase(),
    normalizeText(source.sourceTitle).toLowerCase(),
    normalizeText(source.sessionLabel).toLowerCase(),
    messageIdentity,
    normalizeText(content).toLowerCase(),
    images.join("|"),
  ].join("::");

  let hash = 0;

  for (let index = 0; index < rawKey.length; index++) {
    hash = (hash * 31 + rawKey.charCodeAt(index)) | 0;
  }

  return `bookmark-${Math.abs(hash)}`;
}

function getComparableMessageContent(content: string) {
  return normalizeText(extractMessageTimestamp(content).messageText);
}

function getUserTurnAnchor(messages: ChatMessage[], userMessageIndex: number) {
  const userMessage = messages[userMessageIndex];
  const { messageText, timestamp } = extractMessageTimestamp(
    userMessage?.content || "",
  );

  const baseAnchor = [
    timestamp ? `time:${normalizeText(timestamp).toLowerCase()}` : "",
    `message:${normalizeText(messageText).toLowerCase()}`,
  ]
    .filter(Boolean)
    .join("::");

  let occurrence = 0;

  for (let index = 0; index <= userMessageIndex; index++) {
    const candidate = messages[index];

    if (candidate.role !== "user") {
      continue;
    }

    const candidateDetails = extractMessageTimestamp(candidate.content);
    const candidateAnchor = [
      candidateDetails.timestamp
        ? `time:${normalizeText(candidateDetails.timestamp).toLowerCase()}`
        : "",
      `message:${normalizeText(candidateDetails.messageText).toLowerCase()}`,
    ]
      .filter(Boolean)
      .join("::");

    if (candidateAnchor === baseAnchor) {
      occurrence += 1;
    }
  }

  return `${baseAnchor}::occurrence:${occurrence}`;
}

function getAssistantTurnIdentity(
  messages: ChatMessage[],
  assistantMessageIndex: number,
  sourceType: "chat" | "roleplay",
) {
  let precedingUserIndex = -1;

  for (let index = assistantMessageIndex - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      precedingUserIndex = index;
      break;
    }
  }

  const turnAnchor =
    precedingUserIndex >= 0
      ? getUserTurnAnchor(messages, precedingUserIndex)
      : "initial-session-response";

  const turnStartIndex = precedingUserIndex + 1;
  let assistantReplyNumber = 0;

  for (let index = turnStartIndex; index <= assistantMessageIndex; index++) {
    if (messages[index].role === "assistant") {
      assistantReplyNumber += 1;
    }
  }

  return [
    sourceType,
    "turn",
    turnAnchor,
    `assistant-reply:${assistantReplyNumber}`,
  ].join("::");
}

function isSameBookmarkSource(
  bookmark: BookmarkedMessage,
  source: BookmarkSource,
) {
  if (bookmark.sourceType !== source.sourceType) {
    return false;
  }

  if (
    normalizeText(
      bookmark.moduleTitle || bookmark.sourceTitle,
    ).toLowerCase() !== normalizeText(source.moduleTitle).toLowerCase()
  ) {
    return false;
  }

  if (
    typeof bookmark.sessionIndex === "number" &&
    typeof source.sessionIndex === "number"
  ) {
    return bookmark.sessionIndex === source.sessionIndex;
  }

  if (
    typeof bookmark.sessionNumber === "number" &&
    typeof source.sessionNumber === "number"
  ) {
    return bookmark.sessionNumber === source.sessionNumber;
  }

  return (
    normalizeText(bookmark.sessionLabel || "").toLowerCase() ===
    normalizeText(source.sessionLabel).toLowerCase()
  );
}

function isEquivalentBookmarkedMessage(
  bookmark: BookmarkedMessage,
  source: BookmarkSource,
  messageIdentity: string,
) {
  return (
    isSameBookmarkSource(bookmark, source) &&
    Boolean(bookmark.messageIdentity) &&
    bookmark.messageIdentity === messageIdentity
  );
}

function findBookmarkedMessageIndex(
  messages: ChatMessage[],
  pendingNavigation: PendingBookmarkNavigation,
) {
  const cleanSavedContent = getComparableMessageContent(
    pendingNavigation.messageContent || "",
  );

  if (pendingNavigation.messageIdentity?.startsWith("chat::turn::")) {
    const matchingIdentityIndex = messages.findIndex(
      (message, messageIndex) =>
        message.role === "assistant" &&
        getAssistantTurnIdentity(messages, messageIndex, "chat") ===
          pendingNavigation.messageIdentity &&
        (!cleanSavedContent ||
          getComparableMessageContent(message.content) === cleanSavedContent),
    );

    if (matchingIdentityIndex >= 0) {
      return matchingIdentityIndex;
    }
  }

  // Older bookmarks do not have the new turn-based identity. Use text only
  // when the response appears once; do not guess when repeated text exists.
  if (cleanSavedContent) {
    const matchingAssistantIndexes = messages
      .map((message, messageIndex) => ({
        message,
        messageIndex,
      }))
      .filter(
        ({ message }) =>
          message.role === "assistant" &&
          getComparableMessageContent(message.content) === cleanSavedContent,
      )
      .map(({ messageIndex }) => messageIndex);

    if (matchingAssistantIndexes.length === 1) {
      return matchingAssistantIndexes[0];
    }
  }

  return -1;
}

function getBookmarkSource(
  sourceType: "chat" | "roleplay",
  sourceTitle: string,
  moduleTitle: string,
  sessions: SessionOption[],
  selectedSessionIndex: number | "",
): BookmarkSource {
  const selectedPosition = sessions.findIndex(
    (session) => session.index === selectedSessionIndex,
  );

  const selectedSession =
    selectedPosition >= 0 ? sessions[selectedPosition] : undefined;

  const sessionNumber =
    selectedSession?.displayNumber ??
    (selectedPosition >= 0
      ? Math.max(sessions.length - selectedPosition, 1)
      : undefined);

  return {
    sourceType,
    sourceTitle: sourceTitle.trim() || "Saved Messages",
    moduleTitle: moduleTitle.trim() || sourceTitle.trim() || "Saved Messages",
    sessionIndex:
      typeof selectedSessionIndex === "number"
        ? selectedSessionIndex
        : undefined,
    sessionNumber,
    sessionTitle: selectedSession?.title,
    sessionLabel:
      typeof sessionNumber === "number"
        ? `Session ${sessionNumber}`
        : "Previous / Unidentified Session",
  };
}

function formatRecentDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function extractMessageTimestamp(content: string) {
  const cleanContent = content.trim();

  const timestampPattern =
    /(?:\n\n|\s+)(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+(AM|PM))$/i;

  const match = cleanContent.match(timestampPattern);

  if (!match) {
    return {
      messageText: content,
      timestamp: "",
    };
  }

  return {
    messageText: cleanContent.replace(timestampPattern, "").trim(),
    timestamp: match[1],
  };
}

function getSessionNumber(sessionIndex: number, totalSessions: number) {
  return Math.max(totalSessions - sessionIndex, 1);
}

function getSessionDisplayTitle(
  moduleName: string,
  sessionIndex: number,
  totalSessions: number,
) {
  return `Session ${getSessionNumber(
    sessionIndex,
    totalSessions,
  )} - ${moduleName}`;
}

function filterSessionOptionsForModule(
  moduleName: string,
  sessions: SessionOption[],
) {
  const cleanModuleName = normalizeText(moduleName).toLowerCase();

  const matchingSessions = sessions.filter((session) => {
    const cleanSessionTitle = normalizeText(session.title).toLowerCase();

    if (!cleanSessionTitle || !cleanModuleName) return false;

    return (
      cleanSessionTitle.includes(cleanModuleName) ||
      cleanModuleName.includes(cleanSessionTitle)
    );
  });

  return matchingSessions.map((session, displayIndex) => ({
    ...session,
    displayNumber: Math.max(matchingSessions.length - displayIndex, 1),
  }));
}

export default function AgenticTutorWorkspace() {
  const router = useRouter();

  const [isMounted, setIsMounted] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [openFolders, setOpenFolders] = useState<number[]>([]);

  const [activeView, setActiveView] = useState<
    "dashboard" | "chat" | "activity"
  >("dashboard");

  const [courseModules, setCourseModules] = useState<string[]>([]);
  const [isModulesLoading, setIsModulesLoading] = useState(true);
  const [isReturningHome, setIsReturningHome] = useState(false);

  const [recommendedPromptCards, setRecommendedPromptCards] = useState<
    RecommendedPromptCard[]
  >([]);
  const [isRecommendedPromptsLoading, setIsRecommendedPromptsLoading] =
    useState(true);
  const [openingRecommendedPromptId, setOpeningRecommendedPromptId] =
    useState<string>("");
  const [pendingRecommendedPrompt, setPendingRecommendedPrompt] = useState<{
    recommendation?: RecommendedPrompt;
    moduleTitle: string;
  } | null>(null);
  const [
    isRecommendedPromptClosing,
    setIsRecommendedPromptClosing,
  ] = useState(false);

  const [activitiesByGroup, setActivitiesByGroup] = useState<
    Record<string, ActivityItem[]>
  >({});
  const [isActivitiesLoading, setIsActivitiesLoading] = useState(false);
  const [openingActivityKey, setOpeningActivityKey] = useState<string>("");
  const [hoveredLearningOutcomeModule, setHoveredLearningOutcomeModule] =
    useState("");
  const [learningOutcomesByModule, setLearningOutcomesByModule] = useState<
    Record<string, LearningOutcomesState>
  >({});

  const [activityDetail, setActivityDetail] = useState<ActivityDetail | null>(
    null,
  );
  const [isActivityDetailLoading, setIsActivityDetailLoading] = useState(false);
  const [isActivityNextLoading, setIsActivityNextLoading] = useState(false);
  const [isActivityPreviousLoading, setIsActivityPreviousLoading] =
    useState(false);
  const [isActivitySubmitLoading, setIsActivitySubmitLoading] = useState(false);
  const [isActivityReviewLoading, setIsActivityReviewLoading] = useState(false);

  const [currentActivityQuestionNumber, setCurrentActivityQuestionNumber] =
    useState(1);

  const [selectedActivityAnswers, setSelectedActivityAnswers] = useState<
    Record<string, SelectedActivityAnswer>
  >({});
  const [activityResult, setActivityResult] = useState<ActivityResult | null>(
    null,
  );
  const [activityReview, setActivityReview] = useState<ActivityReview | null>(
    null,
  );
  const [showActivityReview, setShowActivityReview] = useState(false);

  const [roleplayMessages, setRoleplayMessages] = useState<ChatMessage[]>([]);
  const [roleplayInputValue, setRoleplayInputValue] = useState("");
  const [isRoleplayLoading, setIsRoleplayLoading] = useState(false);
  const [roleplaySessionOptions, setRoleplaySessionOptions] = useState<
    SessionOption[]
  >([]);
  const [selectedRoleplaySessionIndex, setSelectedRoleplaySessionIndex] =
    useState<number | "">("");
  const [isRoleplaySessionsLoading, setIsRoleplaySessionsLoading] =
    useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentContext, setCurrentContext] = useState<string>("");
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const roleplayInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [isChatComposerExpanded, setIsChatComposerExpanded] = useState(false);
  const [isRoleplayComposerExpanded, setIsRoleplayComposerExpanded] =
    useState(false);

  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [bookmarkedMessageIds, setBookmarkedMessageIds] = useState<Set<string>>(
    new Set(),
  );
  const [bookmarkedMessages, setBookmarkedMessages] = useState<
    BookmarkedMessage[]
  >([]);
  const [redirectedBookmarkMessageIndex, setRedirectedBookmarkMessageIndex] =
    useState<number | null>(null);
  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>([]);
  const [selectedSessionIndex, setSelectedSessionIndex] = useState<number | "">(
    "",
  );
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);

  const [isScrollNavigatorOpen, setIsScrollNavigatorOpen] = useState(false);
  const [pendingBookmarkNavigation, setPendingBookmarkNavigation] =
    useState<PendingBookmarkNavigation | null>(null);
  const [highlightedMessageIndex, setHighlightedMessageIndex] = useState<
    number | null
  >(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const roleplayMessagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const hasLoadedInitialDataRef = useRef(false);

  useEffect(() => {
    const nextExpanded = resizeComposerTextArea(chatInputRef.current);
    setIsChatComposerExpanded((current) =>
      current === nextExpanded ? current : nextExpanded,
    );
  }, [inputValue]);

  useEffect(() => {
    const nextExpanded = resizeComposerTextArea(roleplayInputRef.current);
    setIsRoleplayComposerExpanded((current) =>
      current === nextExpanded ? current : nextExpanded,
    );
  }, [roleplayInputValue]);

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const resultActionLine =
    activityResult?.lines?.find((line) =>
      /correct answers|review|go to activities/i.test(line),
    ) || "Check out the correct answers to the quiz questions";
  const hasSelectedSessionOption =
    selectedSessionIndex !== "" &&
    sessionOptions.some((session) => session.index === selectedSessionIndex);
  const isDeleteSessionDisabled =
    !currentContext ||
    isLoading ||
    isSessionsLoading ||
    sessionOptions.length <= 1 ||
    !hasSelectedSessionOption;

  const getUserMessagePreview = (content: string) => {
    const { messageText } = extractMessageTimestamp(content);
    const cleanText = messageText.replace(/\s+/g, " ").trim();

    if (!cleanText) return "User message";

    return cleanText.length > 70 ? `${cleanText.slice(0, 70)}...` : cleanText;
  };

  const userMessageMarkers: UserMessageMarker[] = messages
    .map((message, messageIndex) => {
      if (message.role !== "user") return null;

      return {
        messageIndex,
        label: getUserMessagePreview(message.content),
      };
    })
    .filter(Boolean) as UserMessageMarker[];

  const scrollToMessage = (messageIndex: number) => {
    const messageElement = messageRefs.current[messageIndex];

    if (!messageElement) return;

    messageElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    setIsScrollNavigatorOpen(false);
  };

  const getSelectedAnswerForQuestion = (question: QuizQuestion) => {
    return selectedActivityAnswers[normalizeText(question.question)];
  };

  const handleSelectActivityAnswer = (
    question: QuizQuestion,
    choice: string,
    displayedQuestionNumber: number,
  ) => {
    setSelectedActivityAnswers((previousAnswers) => ({
      ...previousAnswers,
      [normalizeText(question.question)]: {
        questionNumber: displayedQuestionNumber,
        question: question.question,
        choice,
      },
    }));
  };

  const saveRecentChats = (nextRecentChats: RecentChat[]) => {
    const cleanedRecentChats = nextRecentChats
      .filter((chat) => chat.context.trim().length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECENT_CHATS);

    setRecentChats(cleanedRecentChats);

    localStorage.setItem(
      RECENT_CHATS_STORAGE_KEY,
      JSON.stringify(cleanedRecentChats),
    );
  };

  const addOrUpdateRecentSessionChat = (
    moduleName: string,
    sessionIndex: number,
    sessions: SessionOption[],
  ) => {
    const cleanModuleName = moduleName.trim();

    if (!cleanModuleName || !Number.isFinite(sessionIndex)) return;

    const selectedSession = sessions.find(
      (session) => session.index === sessionIndex,
    );
    const totalSessions = Math.max(sessions.length, 1);
    const sessionNumber =
      selectedSession?.displayNumber ??
      getSessionNumber(sessionIndex, totalSessions);
    const recentChatId = `${cleanModuleName}::session-${sessionNumber}`;

    const updatedRecentChat: RecentChat = {
      id: recentChatId,
      title: `Session ${sessionNumber} - ${cleanModuleName}`,
      context: cleanModuleName,
      sessionIndex,
      sessionNumber,
      sessionTitle: selectedSession?.title,
      updatedAt: Date.now(),
    };

    setRecentChats((previousRecentChats) => {
      const updatedRecentChats = [
        updatedRecentChat,
        ...previousRecentChats.filter((chat) => chat.id !== recentChatId),
      ]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_RECENT_CHATS);

      localStorage.setItem(
        RECENT_CHATS_STORAGE_KEY,
        JSON.stringify(updatedRecentChats),
      );

      return updatedRecentChats;
    });
  };

  const loadBookmarkedMessageIds = () => {
    const savedBookmarks = localStorage.getItem(BOOKMARKS_STORAGE_KEY);

    if (!savedBookmarks) {
      setBookmarkedMessageIds(new Set());
      setBookmarkedMessages([]);
      return;
    }

    try {
      const parsedBookmarks = JSON.parse(savedBookmarks);

      if (!Array.isArray(parsedBookmarks)) {
        setBookmarkedMessageIds(new Set());
        setBookmarkedMessages([]);
        return;
      }

      const normalChatBookmarks = parsedBookmarks.filter(
        (bookmark: BookmarkedMessage) =>
          bookmark &&
          typeof bookmark.id === "string" &&
          bookmark.sourceType === "chat"
      );

      if (normalChatBookmarks.length !== parsedBookmarks.length) {
        localStorage.setItem(
          BOOKMARKS_STORAGE_KEY,
          JSON.stringify(normalChatBookmarks)
        );
      }

      setBookmarkedMessages(normalChatBookmarks);

      setBookmarkedMessageIds(
        new Set(
          normalChatBookmarks.map(
            (bookmark: BookmarkedMessage) => bookmark.id
          )
        ),
      );
    } catch (error) {
      console.error("Failed to load bookmarked messages:", error);
      setBookmarkedMessageIds(new Set());
      setBookmarkedMessages([]);
    }
  };

  const toggleBookmarkedMessage = (
    message: ChatMessage,
    source: BookmarkSource,
    messageIdentity: string,
  ) => {
    if (source.sourceType !== "chat") {
      return;
    }

    const cleanContent = message.content.trim();
    const images = Array.isArray(message.images) ? message.images : [];

    if (!cleanContent && images.length === 0) return;

    const bookmarkId = createBookmarkId(
      source,
      messageIdentity,
      cleanContent,
      images,
    );

    const savedBookmarks = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    let existingBookmarks: BookmarkedMessage[] = [];

    if (savedBookmarks) {
      try {
        const parsedBookmarks = JSON.parse(savedBookmarks);

        if (Array.isArray(parsedBookmarks)) {
          existingBookmarks = parsedBookmarks;
        }
      } catch (error) {
        console.error("Failed to parse bookmarked messages:", error);
      }
    }

    const exactBookmark = existingBookmarks.find((bookmark) =>
      isEquivalentBookmarkedMessage(bookmark, source, messageIdentity),
    );

    let updatedBookmarks: BookmarkedMessage[];

    if (exactBookmark) {
      updatedBookmarks = existingBookmarks.filter(
        (bookmark) => bookmark.id !== exactBookmark.id,
      );
    } else {
      const legacyBookmarks = existingBookmarks.filter(
        (bookmark) =>
          !bookmark.messageIdentity &&
          isSameBookmarkSource(bookmark, source) &&
          getComparableMessageContent(bookmark.content) ===
            getComparableMessageContent(cleanContent),
      );

      const legacyBookmark =
        legacyBookmarks.length === 1 ? legacyBookmarks[0] : undefined;

      if (legacyBookmark) {
        // Upgrade a legacy bookmark when the user clicks the specific message.
        // It avoids creating a duplicate bookmark while giving it a unique ID.
        updatedBookmarks = existingBookmarks.map((bookmark) =>
          bookmark.id === legacyBookmark.id
            ? {
                ...bookmark,
                id: bookmarkId,
                messageIdentity,
                content: cleanContent,
                images,
                ...source,
              }
            : bookmark,
        );
      } else {
        updatedBookmarks = [
          {
            id: bookmarkId,
            messageIdentity,
            content: cleanContent,
            images,
            ...source,
            createdAt: Date.now(),
          },
          ...existingBookmarks,
        ];
      }
    }

    localStorage.setItem(
      BOOKMARKS_STORAGE_KEY,
      JSON.stringify(updatedBookmarks),
    );

    setBookmarkedMessages(updatedBookmarks);
    setBookmarkedMessageIds(
      new Set(updatedBookmarks.map((bookmark) => bookmark.id)),
    );
  };

  const removeBookmarksForDeletedSession = (
    moduleName: string,
    deletedSessionNumber: number,
  ) => {
    const savedBookmarks = localStorage.getItem(BOOKMARKS_STORAGE_KEY);

    if (!savedBookmarks) return;

    try {
      const parsedBookmarks = JSON.parse(savedBookmarks);

      if (!Array.isArray(parsedBookmarks)) return;

      const cleanModuleName = normalizeText(moduleName).toLowerCase();
      const getBookmarkSessionNumber = (bookmark: BookmarkedMessage) => {
        if (
          typeof bookmark.sessionNumber === "number" &&
          Number.isFinite(bookmark.sessionNumber)
        ) {
          return bookmark.sessionNumber;
        }

        const match = normalizeText(bookmark.sessionLabel || "").match(
          /session\s+(\d+)/i,
        );
        const parsedSessionNumber = match ? Number(match[1]) : NaN;

        return Number.isFinite(parsedSessionNumber)
          ? parsedSessionNumber
          : undefined;
      };

      const updatedBookmarks = parsedBookmarks.flatMap((bookmark) => {
        if (
          !bookmark ||
          bookmark.sourceType !== "chat" ||
          typeof bookmark.content !== "string"
        ) {
          return [bookmark];
        }

        const bookmarkModuleName = normalizeText(
          bookmark.moduleTitle || bookmark.sourceTitle || "",
        ).toLowerCase();

        if (bookmarkModuleName !== cleanModuleName) {
          return [bookmark];
        }

        const bookmarkSessionNumber = getBookmarkSessionNumber(bookmark);

        if (bookmarkSessionNumber === deletedSessionNumber) {
          return [];
        }

        if (
          typeof bookmarkSessionNumber === "number" &&
          bookmarkSessionNumber > deletedSessionNumber
        ) {
          const nextSessionNumber = bookmarkSessionNumber - 1;

          return [
            {
              ...bookmark,
              sessionNumber: nextSessionNumber,
              sessionLabel: `Session ${nextSessionNumber}`,
            },
          ];
        }

        return [bookmark];
      });

      localStorage.setItem(
        BOOKMARKS_STORAGE_KEY,
        JSON.stringify(updatedBookmarks),
      );
      setBookmarkedMessages(updatedBookmarks);
      setBookmarkedMessageIds(
        new Set(
          updatedBookmarks
            .filter(
              (bookmark): bookmark is BookmarkedMessage =>
                bookmark &&
                typeof bookmark.id === "string" &&
                bookmark.sourceType === "chat",
            )
            .map((bookmark) => bookmark.id),
        ),
      );
    } catch (error) {
      console.error("Failed to remove bookmarks for deleted session:", error);
    }
  };

  const isMessageBookmarked = (
    message: ChatMessage,
    source: BookmarkSource,
    messageIdentity: string,
  ) => {
    const cleanContent = message.content.trim();
    const images = Array.isArray(message.images) ? message.images : [];
    const bookmarkId = createBookmarkId(
      source,
      messageIdentity,
      cleanContent,
      images,
    );

    return (
      bookmarkedMessageIds.has(bookmarkId) ||
      bookmarkedMessages.some(
        (bookmark) => bookmark.messageIdentity === messageIdentity,
      )
    );
  };

  const getMatchingCourseModule = (recommendedModuleTitle: string) => {
    const normalizedRecommendedModule = normalizeText(
      recommendedModuleTitle
    ).toLowerCase();

    return (
      courseModules.find(
        (moduleName) =>
          normalizeText(moduleName).toLowerCase() ===
          normalizedRecommendedModule
      ) ||
      courseModules.find((moduleName) => {
        const normalizedModule = normalizeText(moduleName).toLowerCase();

        return (
          normalizedModule.includes(normalizedRecommendedModule) ||
          normalizedRecommendedModule.includes(normalizedModule)
        );
      }) ||
      ""
    );
  };

  const loadRecommendedPrompts = async () => {
    setIsRecommendedPromptsLoading(true);

    try {
      const response = await fetch("/api/nf/recommendations", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load recommended prompts from Noodle Factory."
        );
      }

      setRecommendedPromptCards(
        Array.isArray(data.recommendations) ? data.recommendations : []
      );
    } catch (error) {
      console.error("Error loading Noodle Factory recommended prompts:", error);
      setRecommendedPromptCards([]);
    } finally {
      setIsRecommendedPromptsLoading(false);
    }
  };

  const handleCourseHome = async () => {
    if (isReturningHome) return;

    // Keep the dashboard responsive immediately. The existing module folders
    // are already loaded in React, so there is no need to scrape them again.
    setActiveView("dashboard");
    setIsScrollNavigatorOpen(false);
    setPendingBookmarkNavigation(null);
    setHighlightedMessageIndex(null);
    setRedirectedBookmarkMessageIndex(null);

    setIsReturningHome(true);

    try {
      const response = await fetch("/api/nf/home", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to return to course home.");
      }

      await loadRecommendedPrompts();
    } catch (error) {
      console.error("Error returning Noodle Factory to course home:", error);
      // The frontend dashboard can still be used, but the next Noodle action
      // may need a manual retry if the browser reset itself failed.
    } finally {
      setIsReturningHome(false);
    }
  };

  const loadActivities = async (modules: string[]) => {
    if (modules.length === 0) return;

    setIsActivitiesLoading(true);

    try {
      const response = await fetch("/api/nf/activities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modules,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to load activities");
      }

      const data = await response.json();

      setActivitiesByGroup(data.activitiesByGroup || {});
    } catch (error) {
      console.error("Error loading Noodle Factory activities:", error);
      setActivitiesByGroup({});
    } finally {
      setIsActivitiesLoading(false);
    }
  };

  const loadLearningOutcomes = async (moduleName: string) => {
    const existingState = learningOutcomesByModule[moduleName];

    if (
      existingState?.isLoading ||
      existingState?.hasLoaded ||
      existingState?.error
    ) {
      return;
    }

    setLearningOutcomesByModule((previousOutcomes) => ({
      ...previousOutcomes,
      [moduleName]: {
        outcomes: previousOutcomes[moduleName]?.outcomes || [],
        isLoading: true,
        hasLoaded: previousOutcomes[moduleName]?.hasLoaded || false,
        error: "",
      },
    }));

    try {
      const response = await fetch("/api/nf/learning-outcomes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          moduleTitle: moduleName,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        outcomes?: string[];
        error?: string;
      };

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Failed to load learning outcomes.");
      }

      setLearningOutcomesByModule((previousOutcomes) => ({
        ...previousOutcomes,
        [moduleName]: {
          outcomes: Array.isArray(data.outcomes) ? data.outcomes : [],
          isLoading: false,
          hasLoaded: true,
          error: "",
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load learning outcomes.";

      setLearningOutcomesByModule((previousOutcomes) => ({
        ...previousOutcomes,
        [moduleName]: {
          outcomes: [],
          isLoading: false,
          hasLoaded: true,
          error: message,
        },
      }));
    }
  };

  const handleLearningOutcomesHover = (moduleName: string) => {
    setHoveredLearningOutcomeModule(moduleName);
    void loadLearningOutcomes(moduleName);
  };

  const openActivity = async (activity: ActivityItem) => {
    const activityKey = `${activity.groupTitle}-${activity.title}-${activity.type}`;

    if (openingActivityKey) return;

    setOpeningActivityKey(activityKey);
    setIsActivityDetailLoading(true);
    setActivityDetail(null);
    setSelectedActivityAnswers({});
    setActivityResult(null);
    setActivityReview(null);
    setShowActivityReview(false);
    setRoleplayMessages([]);
    setRoleplayInputValue("");
    setIsRoleplayLoading(false);
    setRoleplaySessionOptions([]);
    setSelectedRoleplaySessionIndex("");
    setIsRoleplaySessionsLoading(false);
    setCurrentActivityQuestionNumber(1);
    setActiveView("activity");

    try {
      const response = await fetch("/api/nf/activity-detail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: activity.title,
          groupTitle: activity.groupTitle,
          type: activity.type,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.activity) {
        throw new Error(data.error || "Failed to load activity.");
      }

      const loadedActivityType = (data.activity.type || activity.type) as
        | "quiz"
        | "roleplay"
        | "unknown";

      const loadedActivity: ActivityDetail = {
        title: activity.title,
        type: loadedActivityType,
        groupTitle: activity.groupTitle,
        mode:
          data.activity.mode ||
          (data.activity.hasNext ? "one-at-a-time" : "all-at-once"),
        questions: Array.isArray(data.activity.questions)
          ? data.activity.questions
          : [],
        hasNext: Boolean(data.activity.hasNext),
        hasPrevious: Boolean(data.activity.hasPrevious),
        roleplayMessages: Array.isArray(data.activity.roleplayMessages)
          ? data.activity.roleplayMessages
          : [],
      };

      setActivityDetail(loadedActivity);

      if (loadedActivityType === "roleplay") {
        setRoleplayMessages(loadedActivity.roleplayMessages || []);
        await loadRoleplaySessionOptions({
          title: loadedActivity.title,
        });
      }
    } catch (error) {
      console.error("Error loading activity detail:", error);
      alert(
        "Failed to load activity inside the project. Check the terminal logs.",
      );
      setActiveView("dashboard");
    } finally {
      setIsActivityDetailLoading(false);
      setOpeningActivityKey("");
    }
  };

  const loadNextActivityQuestion = async () => {
    if (!activityDetail || isActivityNextLoading || !activityDetail.hasNext) {
      return;
    }

    const currentQuestion = activityDetail.questions?.[0];
    const selectedAnswer = currentQuestion
      ? getSelectedAnswerForQuestion(currentQuestion)
      : undefined;

    setIsActivityNextLoading(true);

    try {
      const response = await fetch("/api/nf/activity-next", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          answer: selectedAnswer || null,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.activity) {
        throw new Error(data.error || "Failed to load next question.");
      }

      const nextQuestions = Array.isArray(data.activity.questions)
        ? data.activity.questions
        : [];

      setActivityDetail((previousActivity) => {
        if (!previousActivity) return previousActivity;

        return {
          ...previousActivity,
          mode: previousActivity.mode || "one-at-a-time",
          questions: nextQuestions,
          hasNext: Boolean(data.activity.hasNext),
          hasPrevious: Boolean(data.activity.hasPrevious),
        };
      });

      if (nextQuestions.length > 0) {
        setCurrentActivityQuestionNumber(
          (previousNumber) => previousNumber + 1,
        );
      }
    } catch (error) {
      console.error("Error loading next activity question:", error);
      alert("Failed to load the next question. Check the terminal logs.");
    } finally {
      setIsActivityNextLoading(false);
    }
  };

  const loadPreviousActivityQuestion = async () => {
    if (
      !activityDetail ||
      isActivityPreviousLoading ||
      !activityDetail.hasPrevious
    ) {
      return;
    }

    setIsActivityPreviousLoading(true);

    try {
      const response = await fetch("/api/nf/activity-previous", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok || !data.activity) {
        throw new Error(data.error || "Failed to load previous question.");
      }

      const previousQuestions = Array.isArray(data.activity.questions)
        ? data.activity.questions
        : [];

      setActivityDetail((previousActivity) => {
        if (!previousActivity) return previousActivity;

        return {
          ...previousActivity,
          mode: previousActivity.mode || "one-at-a-time",
          questions: previousQuestions,
          hasNext: Boolean(data.activity.hasNext),
          hasPrevious: Boolean(data.activity.hasPrevious),
        };
      });

      if (previousQuestions.length > 0) {
        setCurrentActivityQuestionNumber((previousNumber) =>
          Math.max(previousNumber - 1, 1),
        );
      }
    } catch (error) {
      console.error("Error loading previous activity question:", error);
      alert("Failed to load the previous question. Check the terminal logs.");
    } finally {
      setIsActivityPreviousLoading(false);
    }
  };

  const submitActivityQuiz = async () => {
    if (!activityDetail || isActivitySubmitLoading) return;

    const questions = activityDetail.questions || [];

    if (questions.length === 0) {
      alert("No quiz questions were detected.");
      return;
    }

    const answeredQuestionNumbers = new Set(
      Object.values(selectedActivityAnswers).map(
        (answer) => answer.questionNumber,
      ),
    );

    const missingQuestionNumbers =
      activityDetail.mode === "one-at-a-time"
        ? Array.from(
            { length: currentActivityQuestionNumber },
            (_, index) => index + 1,
          ).filter(
            (questionNumber) => !answeredQuestionNumbers.has(questionNumber),
          )
        : questions
            .filter((question) => !getSelectedAnswerForQuestion(question))
            .map((question) => question.number);

    if (missingQuestionNumbers.length > 0) {
      alert(
        `Please answer the following question${
          missingQuestionNumbers.length > 1 ? "s" : ""
        } before submitting: ${missingQuestionNumbers
          .map((questionNumber) => `Question ${questionNumber}`)
          .join(", ")}.`,
      );

      return;
    }

    const answers = Object.values(selectedActivityAnswers);

    setIsActivitySubmitLoading(true);

    try {
      const response = await fetch("/api/nf/activity-submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: activityDetail.mode || "all-at-once",
          answers,
          currentAnswers: questions.map((question) =>
            getSelectedAnswerForQuestion(question),
          ),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to submit quiz.");
      }

      setActivityResult(data.result || data.activityResult || null);
      setActivityReview(null);
      setShowActivityReview(false);
    } catch (error) {
      console.error("Error submitting activity quiz:", error);
      alert("Failed to submit the quiz. Check the terminal logs.");
    } finally {
      setIsActivitySubmitLoading(false);
    }
  };

  const loadActivityReview = async () => {
    if (isActivityReviewLoading) return;

    setIsActivityReviewLoading(true);

    try {
      const response = await fetch("/api/nf/activity-review", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok || !data.review) {
        throw new Error(data.error || "Failed to load activity review.");
      }

      setActivityReview(data.review);
    } catch (error) {
      console.error("Error loading activity review:", error);
      setShowActivityReview(false);
      alert(
        "Failed to load the correct answers review. Check the terminal logs.",
      );
    } finally {
      setIsActivityReviewLoading(false);
    }
  };

  const handleToggleActivityReview = async () => {
    if (showActivityReview) {
      setShowActivityReview(false);
      return;
    }

    setShowActivityReview(true);

    if (!activityReview) {
      await loadActivityReview();
    }
  };

  const loadRoleplaySessionOptions = async (options?: {
    preserveSelected?: boolean;
    forcedSelectedIndex?: number;
    title?: string;
  }) => {
    const roleplayTitle = options?.title || activityDetail?.title || "";
    setIsRoleplaySessionsLoading(true);

    try {
      const response = await fetch("/api/nf/activity-roleplay-sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "list",
          title: roleplayTitle,
        }),
      });

      const rawText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Role play sessions route failed with status ${response.status}: ${rawText}`,
        );
      }

      if (!rawText) {
        throw new Error("Role play sessions route returned an empty response.");
      }

      const data = JSON.parse(rawText);
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];

      const nextSelectedSessionIndex = (() => {
        if (
          typeof options?.forcedSelectedIndex === "number" &&
          sessions.some(
            (session: SessionOption) =>
              session.index === options.forcedSelectedIndex,
          )
        ) {
          return options.forcedSelectedIndex;
        }

        if (
          options?.preserveSelected &&
          selectedRoleplaySessionIndex !== "" &&
          sessions.some(
            (session: SessionOption) =>
              session.index === selectedRoleplaySessionIndex,
          )
        ) {
          return selectedRoleplaySessionIndex;
        }

        if (
          typeof data.selectedSessionIndex === "number" &&
          sessions.some(
            (session: SessionOption) =>
              session.index === data.selectedSessionIndex,
          )
        ) {
          return data.selectedSessionIndex;
        }

        const activeSession = sessions.find(
          (session: SessionOption) => session.isActive,
        );

        return activeSession?.index ?? "";
      })();

      const updatedSessions = sessions.map((session: SessionOption) => ({
        ...session,
        isActive: session.index === nextSelectedSessionIndex,
      }));

      setRoleplaySessionOptions(updatedSessions);
      setSelectedRoleplaySessionIndex(nextSelectedSessionIndex);

      return {
        sessions: updatedSessions,
        selectedSessionIndex: nextSelectedSessionIndex,
      };
    } catch (error) {
      console.error("Error loading Noodle Factory role play sessions:", error);
      setRoleplaySessionOptions([]);
      setSelectedRoleplaySessionIndex("");

      return {
        sessions: [],
        selectedSessionIndex: "" as number | "",
      };
    } finally {
      setIsRoleplaySessionsLoading(false);
    }
  };

  const selectRoleplaySessionByIndex = async (
    nextSessionIndex: number,
    knownSessions?: SessionOption[],
  ) => {
    if (!Number.isFinite(nextSessionIndex) || isRoleplayLoading) return;

    setSelectedRoleplaySessionIndex(nextSessionIndex);
    setRoleplaySessionOptions((previousSessions) =>
      previousSessions.map((session) => ({
        ...session,
        isActive: session.index === nextSessionIndex,
      })),
    );

    setRoleplayMessages([]);
    setIsRoleplayLoading(true);

    try {
      const response = await fetch("/api/nf/activity-roleplay-sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "select",
          sessionIndex: nextSessionIndex,
          title: activityDetail?.title || "",
        }),
      });

      const rawText = await response.text();

      if (!rawText) {
        throw new Error("Role play sessions route returned an empty response.");
      }

      const data = JSON.parse(rawText);

      const sessionsFromResponse = Array.isArray(data.sessions)
        ? data.sessions
        : knownSessions || roleplaySessionOptions;

      const updatedSessions = sessionsFromResponse.map(
        (session: SessionOption) => ({
          ...session,
          isActive: session.index === nextSessionIndex,
        }),
      );

      setRoleplaySessionOptions(updatedSessions);
      setSelectedRoleplaySessionIndex(nextSessionIndex);

      if (data.history && data.history.length > 0) {
        setRoleplayMessages(data.history);
      } else if (data.answer || (data.images && data.images.length > 0)) {
        setRoleplayMessages([
          {
            role: "assistant",
            content: data.answer || "",
            images: Array.isArray(data.images) ? data.images : [],
          },
        ]);
      }
    } catch (error) {
      console.error("Error selecting Noodle Factory role play session:", error);
      alert("Failed to select the role play session. Check the terminal logs.");
    } finally {
      setIsRoleplayLoading(false);
    }
  };

  const handleRoleplayNewSession = async () => {
    if (
      !activityDetail ||
      activityDetail.type !== "roleplay" ||
      isRoleplayLoading ||
      isRoleplaySessionsLoading
    ) {
      return;
    }

    setRoleplayMessages([]);
    setSelectedRoleplaySessionIndex("");
    setIsRoleplayLoading(true);

    try {
      const response = await fetch("/api/nf/activity-roleplay-new-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: activityDetail.title,
          groupTitle: activityDetail.groupTitle || "",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create role play session.");
      }

      if (data.history && data.history.length > 0) {
        setRoleplayMessages(data.history);
      } else if (data.answer || (data.images && data.images.length > 0)) {
        setRoleplayMessages([
          {
            role: "assistant",
            content: data.answer || "",
            images: Array.isArray(data.images) ? data.images : [],
          },
        ]);
      }

      await loadRoleplaySessionOptions({
        forcedSelectedIndex: 0,
        title: activityDetail.title,
      });
    } catch (error) {
      console.error("Error creating Noodle Factory role play session:", error);
      alert(
        "Failed to create a new role play session. Check the terminal logs.",
      );
    } finally {
      setIsRoleplayLoading(false);
    }
  };

  const handleSelectRoleplaySession = async (sessionIndexValue: string) => {
    const nextSessionIndex = Number(sessionIndexValue);

    if (
      isRoleplayLoading ||
      isRoleplaySessionsLoading ||
      !Number.isFinite(nextSessionIndex)
    ) {
      return;
    }

    await selectRoleplaySessionByIndex(nextSessionIndex);
  };

  const loadSessionOptions = async (
    moduleName: string,
    options?: {
      preserveSelected?: boolean;
      forcedSelectedIndex?: number;
    },
  ) => {
    const cleanModuleName = moduleName.trim();

    if (!cleanModuleName) {
      setSessionOptions([]);
      setSelectedSessionIndex("");
      return {
        sessions: [],
        selectedSessionIndex: "" as number | "",
      };
    }

    setIsSessionsLoading(true);

    try {
      const response = await fetch("/api/nf/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "list",
          context: cleanModuleName,
        }),
      });

      const rawText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Sessions route failed with status ${response.status}: ${rawText}`,
        );
      }

      if (!rawText) {
        throw new Error("Sessions route returned an empty response.");
      }

      const data = JSON.parse(rawText);
      const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
      const sessions = filterSessionOptionsForModule(cleanModuleName, rawSessions);

      const nextSelectedSessionIndex = (() => {
        if (typeof options?.forcedSelectedIndex === "number") {
          return options.forcedSelectedIndex;
        }

        if (
          options?.preserveSelected &&
          selectedSessionIndex !== "" &&
          sessions.some(
            (session: SessionOption) => session.index === selectedSessionIndex,
          )
        ) {
          return selectedSessionIndex;
        }

        if (typeof data.selectedSessionIndex === "number") {
          return data.selectedSessionIndex;
        }

        const activeSession = sessions.find(
          (session: SessionOption) => session.isActive,
        );

        return activeSession?.index ?? sessions[0]?.index ?? "";
      })();

      const updatedSessions = sessions.map((session: SessionOption) => ({
        ...session,
        isActive: session.index === nextSelectedSessionIndex,
      }));

      setSessionOptions(updatedSessions);
      setSelectedSessionIndex(nextSelectedSessionIndex);

      return {
        sessions: updatedSessions,
        selectedSessionIndex: nextSelectedSessionIndex,
      };
    } catch (error) {
      console.error("Error loading Noodle Factory sessions:", error);
      setSessionOptions([]);
      setSelectedSessionIndex("");

      return {
        sessions: [],
        selectedSessionIndex: "" as number | "",
      };
    } finally {
      setIsSessionsLoading(false);
    }
  };

  const selectSessionByIndex = async (
    moduleName: string,
    nextSessionIndex: number,
    knownSessions?: SessionOption[],
  ) => {
    if (!moduleName || !Number.isFinite(nextSessionIndex)) return;

    // The visible Noodle session title is stable. A numeric dropdown index can
    // shift when other sessions are inserted, so pass both and let the route
    // prefer the exact title.
    const sessionsForSelection = knownSessions || sessionOptions;
    const requestedSessionTitle =
      sessionsForSelection.find(
        (session) => session.index === nextSessionIndex,
      )?.title || "";

    setSelectedSessionIndex(nextSessionIndex);
    setSessionOptions((previousSessions) =>
      previousSessions.map((session) => ({
        ...session,
        isActive: session.index === nextSessionIndex,
      })),
    );

    setMessages([]);
    setRedirectedBookmarkMessageIndex(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/nf/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "select",
          context: moduleName,
          sessionIndex: nextSessionIndex,
          sessionTitle: requestedSessionTitle,
        }),
      });

      const rawText = await response.text();

      if (!rawText) {
        throw new Error("Sessions route returned an empty response.");
      }

      const data = JSON.parse(rawText);

      const actualSelectedSessionIndex =
        typeof data.selectedSessionIndex === "number"
          ? data.selectedSessionIndex
          : nextSessionIndex;

      const rawSessionsFromResponse = Array.isArray(data.sessions)
        ? data.sessions
        : knownSessions || sessionOptions;

      const sessionsFromResponse = filterSessionOptionsForModule(
        moduleName,
        rawSessionsFromResponse,
      );

      const updatedSessions = sessionsFromResponse.map(
        (session: SessionOption) => ({
          ...session,
          isActive: session.index === actualSelectedSessionIndex,
        }),
      );

      setSessionOptions(updatedSessions);
      setSelectedSessionIndex(actualSelectedSessionIndex);

      if (data.history && data.history.length > 0) {
        setMessages(data.history);
      } else if (data.answer || (data.images && data.images.length > 0)) {
        setMessages([
          {
            role: "assistant",
            content: data.answer || "",
            images: Array.isArray(data.images) ? data.images : [],
          },
        ]);
      }

      addOrUpdateRecentSessionChat(
        moduleName,
        actualSelectedSessionIndex,
        updatedSessions,
      );
    } catch (error) {
      console.error("Error selecting Noodle Factory session:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const startContextualChat = async (
    moduleName: string,
    options?: {
      sessionTitle?: string;
      sessionNumber?: number;
      sessionIndex?: number;
    },
  ) => {
    setCurrentContext(moduleName);
    setActiveView("chat");
    setMessages([]);
    setRedirectedBookmarkMessageIndex(null);
    setSessionOptions([]);
    setSelectedSessionIndex("");
    setIsLoading(true);

    try {
      if (
        typeof options?.sessionTitle === "string" ||
        typeof options?.sessionNumber === "number" ||
        typeof options?.sessionIndex === "number"
      ) {
        const sessionLoadResult = await loadSessionOptions(moduleName);

        const sessions = sessionLoadResult.sessions;
        const totalSessions = sessions.length;

        // A dropdown index can change when Noodle adds sessions from another
        // module. Prefer the saved title only when it is unique; Noodle can
        // create many chat sessions with the exact same visible module title.
        const savedSessionTitle = options?.sessionTitle || "";
        const savedSessionNumber =
          typeof options?.sessionNumber === "number"
            ? options.sessionNumber
            : undefined;
        const savedSessionIndex =
          typeof options?.sessionIndex === "number"
            ? options.sessionIndex
            : undefined;

        const cleanSavedSessionTitle = normalizeText(
          savedSessionTitle,
        ).toLowerCase();

        const exactTitleMatches = cleanSavedSessionTitle
          ? sessions.filter(
              (session) =>
                normalizeText(session.title).toLowerCase() ===
                cleanSavedSessionTitle,
            )
          : [];

        const partialTitleMatches =
          cleanSavedSessionTitle && exactTitleMatches.length === 0
            ? sessions.filter((session) =>
                normalizeText(session.title)
                  .toLowerCase()
                  .includes(cleanSavedSessionTitle),
              )
            : [];

        const sessionBySavedTitle =
          exactTitleMatches.length === 1
            ? exactTitleMatches[0]
            : partialTitleMatches.length === 1
              ? partialTitleMatches[0]
              : undefined;

        let targetSessionIndex = sessionBySavedTitle?.index ?? "";

        // Older recent entries do not have sessionTitle. Their visible Session
        // number is a safer fallback than a stale raw dropdown index.
        if (
          typeof targetSessionIndex !== "number" &&
          typeof savedSessionNumber === "number"
        ) {
          const sessionByDisplayNumber = sessions.find(
            (session) => session.displayNumber === savedSessionNumber,
          );

          const sessionByPosition =
            totalSessions > 0
              ? sessions[Math.max(totalSessions - savedSessionNumber, 0)]
              : undefined;

          targetSessionIndex =
            sessionByDisplayNumber?.index ?? sessionByPosition?.index ?? "";
        }

        // Use the raw index only as the final fallback for legacy entries.
        if (
          typeof targetSessionIndex !== "number" &&
          typeof savedSessionIndex === "number" &&
          sessions.some((session) => session.index === savedSessionIndex)
        ) {
          targetSessionIndex = savedSessionIndex;
        }

        if (
          typeof targetSessionIndex === "number" &&
          sessions.some((session) => session.index === targetSessionIndex)
        ) {
          await selectSessionByIndex(moduleName, targetSessionIndex, sessions);
          return;
        }
      }

      const response = await fetch("/api/nf/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: "",
          context: moduleName,
        }),
      });

      const data = await response.json();

      if (data.history && data.history.length > 0) {
        setMessages(data.history);
      }

      const sessionLoadResult = await loadSessionOptions(moduleName);

      if (typeof sessionLoadResult.selectedSessionIndex === "number") {
        addOrUpdateRecentSessionChat(
          moduleName,
          sessionLoadResult.selectedSessionIndex,
          sessionLoadResult.sessions,
        );
      }
    } catch (error) {
      console.error("Error pre-loading chat module history threads:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const showRecommendedPromptConfirmation = (
    moduleTitle: string,
    recommendation?: RecommendedPrompt,
  ) => {
    if (openingRecommendedPromptId || isReturningHome) {
      return;
    }

    setIsRecommendedPromptClosing(false);
    setPendingRecommendedPrompt({
      moduleTitle,
      recommendation,
    });
  };

  const closeRecommendedPromptConfirmation = () => {
    if (!pendingRecommendedPrompt || isRecommendedPromptClosing) {
      return;
    }

    setIsRecommendedPromptClosing(true);

    window.setTimeout(() => {
      setPendingRecommendedPrompt(null);
      setIsRecommendedPromptClosing(false);
    }, 220);
  };

  const getRecommendedPromptVisualType = (
    recommendation: RecommendedPrompt,
  ) => {
    const promptText = normalizeText(recommendation.text).toLowerCase();

    if (promptText.startsWith("explore")) {
      return "explore" as const;
    }

    return recommendation.type === "review"
      ? ("review" as const)
      : ("practice" as const);
  };

  const openRecommendedPrompt = async (
    recommendation: RecommendedPrompt,
    recommendedModuleTitle: string
  ) => {
    if (openingRecommendedPromptId || isReturningHome) {
      return;
    }

    const matchingModuleName = getMatchingCourseModule(recommendedModuleTitle);

    if (!matchingModuleName) {
      alert(
        `The recommended prompt belongs to "${recommendedModuleTitle}", but that module could not be found in the current course.`
      );
      return;
    }

    setOpeningRecommendedPromptId(recommendation.id);

    try {
      await startContextualChat(matchingModuleName);

      const userMessage = recommendation.text.trim();

      if (!userMessage) {
        return;
      }

      setMessages((previousMessages) => [
        ...previousMessages,
        {
          role: "user",
          content: userMessage,
        },
      ]);

      setIsLoading(true);

      const response = await fetch("/api/nf/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: userMessage,
          context: matchingModuleName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send the recommended prompt.");
      }

      if (data.history && data.history.length > 0) {
        setMessages(data.history);
      } else if (data.answer || (data.images && data.images.length > 0)) {
        setMessages((previousMessages) => [
          ...previousMessages,
          {
            role: "assistant",
            content: data.answer || "",
            images: Array.isArray(data.images) ? data.images : [],
          },
        ]);
      }

      const sessionLoadResult = await loadSessionOptions(matchingModuleName, {
        preserveSelected: true,
      });

      const sessionIndexForRecent =
        typeof sessionLoadResult.selectedSessionIndex === "number"
          ? sessionLoadResult.selectedSessionIndex
          : selectedSessionIndex;

      if (typeof sessionIndexForRecent === "number") {
        addOrUpdateRecentSessionChat(
          matchingModuleName,
          sessionIndexForRecent,
          sessionLoadResult.sessions
        );
      }
    } catch (error) {
      console.error("Error opening a Noodle Factory recommended prompt:", error);
      alert(
        "The recommended prompt could not be opened. Check the terminal logs and try again."
      );
      setActiveView("dashboard");
    } finally {
      setIsLoading(false);
      setOpeningRecommendedPromptId("");
    }
  };

  const confirmRecommendedPrompt = async () => {
    const selectedPrompt = pendingRecommendedPrompt;

    if (!selectedPrompt || openingRecommendedPromptId || isReturningHome) {
      return;
    }

    closeRecommendedPromptConfirmation();

    if (selectedPrompt.recommendation) {
      await openRecommendedPrompt(
        selectedPrompt.recommendation,
        selectedPrompt.moduleTitle,
      );
      return;
    }

    const matchingModuleName = getMatchingCourseModule(
      selectedPrompt.moduleTitle,
    );

    if (!matchingModuleName) {
      alert(
        `The module "${selectedPrompt.moduleTitle}" could not be found in the current course.`,
      );
      return;
    }

    setOpeningRecommendedPromptId(`module-${matchingModuleName}`);

    try {
      await startContextualChat(matchingModuleName);
    } catch (error) {
      console.error("Error opening recommended module:", error);
      alert(
        "The recommended module could not be opened. Check the terminal logs and try again.",
      );
      setActiveView("dashboard");
    } finally {
      setOpeningRecommendedPromptId("");
    }
  };

  const openRecentChat = async (recentChat: RecentChat) => {
    saveRecentChats([
      {
        ...recentChat,
        updatedAt: Date.now(),
      },
      ...recentChats.filter((chat) => chat.id !== recentChat.id),
    ]);

    await startContextualChat(recentChat.context, {
      sessionTitle: recentChat.sessionTitle,
      sessionNumber: recentChat.sessionNumber,
      sessionIndex: recentChat.sessionIndex,
    });
  };

  const handleNewSession = async () => {
    if (!currentContext || isLoading) return;

    setMessages([]);
    setRedirectedBookmarkMessageIndex(null);
    setSelectedSessionIndex("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/nf/new-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          context: currentContext,
        }),
      });

      const data = await response.json();

      if (data.history && data.history.length > 0) {
        setMessages(data.history);
      } else if (data.answer || (data.images && data.images.length > 0)) {
        setMessages([
          {
            role: "assistant",
            content: data.answer || "",
            images: Array.isArray(data.images) ? data.images : [],
          },
        ]);
      }

      const sessionLoadResult = await loadSessionOptions(currentContext, {
        forcedSelectedIndex: 0,
      });

      if (sessionLoadResult.sessions.length > 0) {
        addOrUpdateRecentSessionChat(
          currentContext,
          0,
          sessionLoadResult.sessions,
        );
      }
    } catch (error) {
      console.error("Error creating new Noodle Factory session:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectSession = async (sessionIndexValue: string) => {
    const nextSessionIndex = Number(sessionIndexValue);

    if (
      !currentContext ||
      isLoading ||
      isSessionsLoading ||
      !Number.isFinite(nextSessionIndex)
    ) {
      return;
    }

    await selectSessionByIndex(currentContext, nextSessionIndex);
  };

  const handleDeleteSession = async () => {
    if (isDeleteSessionDisabled) {
      return;
    }

    const selectedSession = sessionOptions.find(
      (session) => session.index === selectedSessionIndex,
    );

    if (!selectedSession) return;

    const selectedSessionNumber =
      selectedSession.displayNumber ??
      getSessionNumber(selectedSession.index, Math.max(sessionOptions.length, 1));
    const selectedSessionLabel = `Session ${selectedSessionNumber} - ${currentContext}`;
    const shouldDelete = window.confirm(
      `Delete "${selectedSessionLabel}" from Noodle Factory?\n\nThis permanently deletes the selected Noodle Factory session.`,
    );

    if (!shouldDelete) return;

    setMessages([]);
    setRedirectedBookmarkMessageIndex(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/nf/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          context: currentContext,
          sessionIndex: selectedSession.index,
          sessionTitle: selectedSession.title,
        }),
      });

      const rawText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Sessions route failed with status ${response.status}: ${rawText}`,
        );
      }

      if (!rawText) {
        throw new Error("Sessions route returned an empty response.");
      }

      const data = JSON.parse(rawText);
      const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
      const sessions = filterSessionOptionsForModule(currentContext, rawSessions);
      const nextSelectedSessionIndex =
        typeof data.selectedSessionIndex === "number"
          ? data.selectedSessionIndex
          : sessions[0]?.index ?? "";
      const updatedSessions = sessions.map((session: SessionOption) => ({
        ...session,
        isActive: session.index === nextSelectedSessionIndex,
      }));

      setSessionOptions(updatedSessions);
      setSelectedSessionIndex(nextSelectedSessionIndex);

      saveRecentChats(
        recentChats.flatMap((chat) => {
          if (chat.context !== currentContext) {
            return [chat];
          }

          if (chat.sessionNumber === selectedSessionNumber) {
            return [];
          }

          if (
            typeof chat.sessionNumber === "number" &&
            chat.sessionNumber > selectedSessionNumber
          ) {
            const nextSessionNumber = chat.sessionNumber - 1;

            return [
              {
                ...chat,
                id: `${currentContext}::session-${nextSessionNumber}`,
                title: `Session ${nextSessionNumber} - ${currentContext}`,
                sessionNumber: nextSessionNumber,
              },
            ];
          }

          return [chat];
        }),
      );

      removeBookmarksForDeletedSession(currentContext, selectedSessionNumber);

      if (typeof nextSelectedSessionIndex === "number") {
        await selectSessionByIndex(
          currentContext,
          nextSelectedSessionIndex,
          updatedSessions,
        );
      }
    } catch (error) {
      console.error("Error deleting Noodle Factory session:", error);
      alert("Failed to delete this session. Check the terminal logs.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeView === "chat") {
      const scrollTimer = setTimeout(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 80);

      return () => clearTimeout(scrollTimer);
    }
  }, [messages, activeView]);

  useEffect(() => {
    if (
      !pendingBookmarkNavigation ||
      pendingBookmarkNavigation.sourceType !== "chat" ||
      activeView !== "chat" ||
      isLoading ||
      messages.length === 0
    ) {
      return;
    }

    const targetMessageIndex = findBookmarkedMessageIndex(
      messages,
      pendingBookmarkNavigation,
    );

    if (targetMessageIndex < 0) {
      setPendingBookmarkNavigation(null);
      return;
    }

    let retryTimer: number | undefined;
    let attemptCount = 0;

    const scrollToBookmarkedMessage = () => {
      const targetMessageElement = messageRefs.current[targetMessageIndex];

      if (!targetMessageElement && attemptCount < 12) {
        attemptCount += 1;
        retryTimer = window.setTimeout(scrollToBookmarkedMessage, 120);
        return;
      }

      if (!targetMessageElement) {
        setPendingBookmarkNavigation(null);
        return;
      }

      targetMessageElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      setRedirectedBookmarkMessageIndex(targetMessageIndex);
      setHighlightedMessageIndex(targetMessageIndex);
      setPendingBookmarkNavigation(null);
    };

    retryTimer = window.setTimeout(scrollToBookmarkedMessage, 560);

    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [activeView, isLoading, messages, pendingBookmarkNavigation]);

  useEffect(() => {
    if (highlightedMessageIndex === null) {
      return;
    }

    const highlightTimer = window.setTimeout(() => {
      setHighlightedMessageIndex(null);
    }, 2400);

    return () => {
      window.clearTimeout(highlightTimer);
    };
  }, [highlightedMessageIndex]);

  useEffect(() => {
    if (hasLoadedInitialDataRef.current) return;

    hasLoadedInitialDataRef.current = true;
    setIsMounted(true);

    const savedRecentChats = localStorage.getItem(RECENT_CHATS_STORAGE_KEY);

    if (savedRecentChats) {
      try {
        const parsedRecentChats = JSON.parse(savedRecentChats);

        if (Array.isArray(parsedRecentChats)) {
          setRecentChats(parsedRecentChats);
        }
      } catch (error) {
        console.error("Failed to load recent chats:", error);
      }
    }

    loadBookmarkedMessageIds();

    async function loadHomeData() {
      setIsRecommendedPromptsLoading(true);

      try {
        const response = await fetch("/api/nf/home-data", {
          method: "POST",
          cache: "no-store",
        });

        const rawResponse = await response.text();
        let data: {
          ok?: boolean;
          modules?: string[];
          recommendations?: RecommendedPromptCard[];
          error?: string;
        } | null = null;

        try {
          data = rawResponse.trim() ? JSON.parse(rawResponse) : null;
        } catch {
          throw new Error(
            `[Home Data] HTTP ${response.status}: /api/nf/home-data returned an invalid response. ` +
              `Make sure the file is exactly at app/api/nf/home-data/route.ts. ` +
              `Response preview: ${rawResponse.slice(0, 180) || "(empty response)"}`
          );
        }

        if (!response.ok || !data?.ok) {
          throw new Error(
            data?.error ||
              `[Home Data] HTTP ${response.status}: endpoint returned no usable data.`
          );
        }

        const loadedModules = Array.isArray(data.modules)
          ? data.modules
          : [];

        setCourseModules(loadedModules);
        setRecommendedPromptCards(
          Array.isArray(data.recommendations) ? data.recommendations : []
        );

        // Activities still use their proven independent route. At this point,
        // Puppeteer is already at Course Home, so the next navigation is only
        // Course Home → Activities.
        await loadActivities(loadedModules);
      } catch (homeDataError) {
        console.error(
          "Home-data route failed. Falling back to the existing separate routes:",
          homeDataError
        );

        // Safe fallback: the original routes stay in the project and are used
        // only when the optimized Course Home scrape fails.
        try {
          const moduleResponse = await fetch("/api/nf/modules");

          if (!moduleResponse.ok) {
            throw new Error("Failed to load modules");
          }

          const moduleData = await moduleResponse.json();
          const loadedModules = Array.isArray(moduleData.modules)
            ? moduleData.modules
            : Array.isArray(moduleData)
              ? moduleData
              : [];

          setCourseModules(loadedModules);
          await loadActivities(loadedModules);
          await loadRecommendedPrompts();
        } catch (fallbackError) {
          console.error(
            "Error loading dashboard data through fallback routes:",
            fallbackError
          );
          setCourseModules(["Error loading modules from backend"]);
          setActivitiesByGroup({});
          setRecommendedPromptCards([]);
        }
      } finally {
        setIsRecommendedPromptsLoading(false);
        setIsModulesLoading(false);
      }
    }

    async function bootstrapWorkspace() {
      await loadHomeData();

      const savedPendingNavigation = localStorage.getItem(
        PENDING_BOOKMARK_NAVIGATION_STORAGE_KEY,
      );

      if (!savedPendingNavigation) {
        return;
      }

      localStorage.removeItem(PENDING_BOOKMARK_NAVIGATION_STORAGE_KEY);

      try {
        const pendingNavigation = JSON.parse(
          savedPendingNavigation,
        ) as PendingBookmarkNavigation;

        if (
          pendingNavigation.sourceType === "chat" &&
          pendingNavigation.moduleTitle?.trim()
        ) {
          setPendingBookmarkNavigation(pendingNavigation);

          await startContextualChat(pendingNavigation.moduleTitle, {
            sessionTitle: pendingNavigation.sessionTitle,
            sessionIndex: pendingNavigation.sessionIndex,
            sessionNumber: pendingNavigation.sessionNumber,
          });
          return;
        }

        if (pendingNavigation.sourceType === "roleplay") {
          window.alert(
            "Role play session redirection is not enabled yet because opening a role play activity in Noodle Factory can create a duplicate session. Your normal chat bookmarks can safely use Go to Session.",
          );
        }
      } catch (error) {
        console.error("Failed to open the saved bookmark session:", error);
      }
    }

    void bootstrapWorkspace();
  }, []);

  useEffect(() => {
    if (activeView === "activity" && activityDetail?.type === "roleplay") {
      const scrollTimer = setTimeout(() => {
        if (roleplayMessagesEndRef.current) {
          roleplayMessagesEndRef.current.scrollIntoView({
            behavior: "smooth",
          });
        }
      }, 80);

      return () => clearTimeout(scrollTimer);
    }
  }, [roleplayMessages, activeView, activityDetail?.type]);

  if (!isMounted) return null;

  const toggleFolder = (index: number) => {
    if (openFolders.includes(index)) {
      setOpenFolders(openFolders.filter((i) => i !== index));
    } else {
      setOpenFolders([...openFolders, index]);
    }
  };

  const handleSendRoleplayMessage = async (e: FormEvent) => {
    e.preventDefault();

    if (!roleplayInputValue.trim() || isRoleplayLoading) return;

    const userMessage = roleplayInputValue.trim();

    setRoleplayMessages((previousMessages) => [
      ...previousMessages,
      {
        role: "user",
        content: userMessage,
      },
    ]);

    setRoleplayInputValue("");
    setIsRoleplayLoading(true);

    try {
      const response = await fetch("/api/nf/activity-roleplay-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send role play message.");
      }

      if (data.history && data.history.length > 0) {
        setRoleplayMessages(data.history);
      } else if (data.answer || (data.images && data.images.length > 0)) {
        setRoleplayMessages((previousMessages) => [
          ...previousMessages,
          {
            role: "assistant",
            content: data.answer || "",
            images: Array.isArray(data.images) ? data.images : [],
          },
        ]);
      }

      await loadRoleplaySessionOptions({
        preserveSelected: true,
        title: activityDetail?.title || "",
      });
    } catch (error) {
      console.error("Role play backend interaction failed:", error);
      alert("Failed to send the role play message. Check the terminal logs.");
    } finally {
      setIsRoleplayLoading(false);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
      },
    ]);

    setInputValue("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/nf/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: userMessage,
          context: currentContext,
        }),
      });

      const data = await response.json();

      if (data.history && data.history.length > 0) {
        setMessages(data.history);
      } else if (data.answer || (data.images && data.images.length > 0)) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer || "",
            images: Array.isArray(data.images) ? data.images : [],
          },
        ]);
      }

      const sessionLoadResult = await loadSessionOptions(currentContext, {
        preserveSelected: true,
      });

      const sessionIndexForRecent =
        selectedSessionIndex !== ""
          ? selectedSessionIndex
          : sessionLoadResult.selectedSessionIndex;

      if (typeof sessionIndexForRecent === "number") {
        addOrUpdateRecentSessionChat(
          currentContext,
          sessionIndexForRecent,
          sessionLoadResult.sessions,
        );
      }
    } catch (error) {
      console.error("Chat backend stream pipeline broken:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex h-screen w-full bg-stone-50 overflow-hidden font-sans">
      <div
        className={`flex flex-col bg-stone-900 transition-all duration-300 ease-in-out border-r border-stone-800 shrink-0 h-full overflow-hidden ${
          isChatOpen ? "w-[320px]" : "w-16"
        }`}
      >
        <div
          className={`flex items-center h-16 shrink-0 mt-2 ${
            isChatOpen ? "justify-between px-4" : "justify-center"
          }`}
        >
          {isChatOpen && (
            <h2 className="font-bold text-white tracking-tight text-lg pl-2">
              Walter AI
            </h2>
          )}

          <button
            type="button"
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="p-2 rounded-md hover:bg-stone-800 text-stone-400 transition-colors"
            title={isChatOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              {isChatOpen ? (
                <path d="m15 9-3 3 3 3M9 3v18" />
              ) : (
                <path d="m11 15 3-3-3-3M9 3v18" />
              )}
            </svg>
          </button>
        </div>

        <nav className="px-3 shrink-0 mb-4 mt-2 space-y-1">
          <button
            type="button"
            onClick={handleCourseHome}
            disabled={isReturningHome}
            className={`w-full flex items-center h-10 rounded-lg transition-colors font-medium text-sm disabled:cursor-wait disabled:opacity-60 ${
              activeView === "dashboard"
                ? "text-red-400 bg-stone-800"
                : "text-stone-300 hover:bg-stone-800"
            } ${isChatOpen ? "px-3 justify-start gap-3" : "justify-center"}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>

            {isChatOpen && <span>Course Home</span>}
          </button>

          <button
            onClick={() => router.push("/bookmarks")}
            className={`w-full flex items-center h-10 rounded-lg text-stone-300 hover:bg-stone-800 transition-colors font-medium text-sm ${
              isChatOpen ? "px-3 justify-start gap-3" : "justify-center"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>

            {isChatOpen && <span>Bookmarks</span>}
          </button>

          <button
            type="button"
            onClick={() => router.push("/grades")}
            className={`w-full flex items-center h-10 rounded-lg text-stone-300 hover:bg-stone-800 transition-colors font-medium text-sm ${
              isChatOpen ? "px-3 justify-start gap-3" : "justify-center"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 19V5" />
              <path d="M4 19h16" />
              <path d="M8 16v-5" />
              <path d="M12 16V8" />
              <path d="M16 16v-3" />
            </svg>

            {isChatOpen && <span>Grades</span>}
          </button>

          <button
            type="button"
            onClick={() => router.push("/ai-feedback")}
            className={`w-full flex items-center h-10 rounded-lg text-stone-300 hover:bg-stone-800 transition-colors font-medium text-sm ${
              isChatOpen ? "px-3 justify-start gap-3" : "justify-center"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 9h8" />
              <path d="M8 13h5" />
            </svg>

            {isChatOpen && <span>AI Feedback</span>}
          </button>

          <button
            type="button"
            onClick={() => router.push("/user-notes")}
            className={`w-full flex items-center h-10 rounded-lg text-stone-300 hover:bg-stone-800 transition-colors font-medium text-sm ${
              isChatOpen ? "px-3 justify-start gap-3" : "justify-center"
            }`}
            title="User Notes"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
              <path d="M8 13h8" />
              <path d="M8 17h5" />
            </svg>

            {isChatOpen && <span>User Notes</span>}
          </button>
        </nav>

        <div className="px-4 shrink-0">
          <div className="h-px bg-stone-800 w-full" />
        </div>

        <div
          className={`mt-2 flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-200 ${
            isChatOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <div className="px-5 py-2 shrink-0">
            <h3 className="text-xs font-semibold text-stone-500 tracking-wide">
              Recent
            </h3>
          </div>

          <div className="recent-chats-scroll flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-1">
            {recentChats.length === 0 && (
              <p className="px-3 py-2 text-xs text-stone-500">
                No recent session chats yet.
              </p>
            )}

            {recentChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => openRecentChat(chat)}
                className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-stone-300 hover:bg-stone-800 hover:text-white transition-colors text-sm text-left group"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="shrink-0 mt-0.5 text-stone-500 group-hover:text-stone-300"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{chat.title}</p>
                  <p className="truncate text-[11px] text-stone-500 group-hover:text-stone-400 mt-0.5">
                    Last opened {formatRecentDate(chat.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <LogoutButton expanded={isChatOpen} />
      </div>

      <div className="flex-1 bg-stone-50 flex flex-col h-full min-w-0 overflow-hidden">
        {activeView === "dashboard" && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 w-full custom-scrollbar">
            {isReturningHome && (
              <div
                className="pointer-events-none z-50"
                style={{
                  position: "fixed",
                  top: "1.25rem",
                  right: "1.5rem",
                }}
              >
                <div
                  className="flex items-center gap-2 rounded-full border border-red-100 bg-white px-3 py-2 text-xs font-semibold text-stone-600 shadow-md"
                  role="status"
                  aria-live="polite"
                >
                  <svg
                    className="animate-spin text-red-600"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" />
                  </svg>
                  Refreshing Course Home...
                </div>
              </div>
            )}

            <div className="px-1">
              <h2 className="font-bold text-stone-800 text-xl">
                AIIO Test Course Production Test
              </h2>

              <p className="mt-1 text-sm text-stone-500">
                Welcome to your Agentic Learning Workspace. Select a module below to begin.
              </p>
            </div>

            <div className="mt-6 mb-4 flex w-full justify-center">
              <section
                className="w-full space-y-2"
                style={{ maxWidth: "740px" }}
              >
              {isRecommendedPromptsLoading &&
                recommendedPromptCards.length === 0 &&
                !isReturningHome && (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-500 shadow-sm">
                    <svg
                      className="animate-spin text-red-600"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" />
                    </svg>
                    Preparing your recommended prompts...
                  </div>
                )}

              {recommendedPromptCards.length > 0 && (
                  <div className="space-y-3">
                    {recommendedPromptCards.map((card) => (
                      <article
                        key={card.id}
                        onClick={() =>
                          showRecommendedPromptConfirmation(card.moduleTitle)
                        }
                        className="group w-full cursor-pointer overflow-hidden rounded-xl border border-red-200 bg-gradient-to-br from-red-50/80 via-white to-rose-50/50 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-red-300 hover:shadow-lg"
                      >
                        <div className="bg-red-50/75 px-4 pt-3 pb-1.5">
                          <div className="border-b border-red-100 pb-2">
                            <div className="flex items-center justify-center gap-2 text-sm font-bold text-red-700">
                              <svg
                                width="17"
                                height="17"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                              >
                                <path d="M9 18h6" />
                                <path d="M10 22h4" />
                                <path d="M12 2a7 7 0 0 0-4 12.74c.64.48 1 1.23 1 2.03V17h6v-.23c0-.8.36-1.55 1-2.03A7 7 0 0 0 12 2Z" />
                              </svg>

                              <span>Recommended for you</span>
                            </div>
                          </div>

                          <h4 className="mt-2 text-sm font-semibold text-stone-800">
                            {card.moduleTitle}
                          </h4>
                        </div>

                        <div>
                          {card.prompts.map((recommendation) => {
                            const isOpening =
                              openingRecommendedPromptId === recommendation.id;
                            const promptVisualType =
                              getRecommendedPromptVisualType(recommendation);

                            return (
                              <button
                                key={recommendation.id}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();

                                  showRecommendedPromptConfirmation(
                                    card.moduleTitle,
                                    recommendation,
                                  );
                                }}
                                disabled={
                                  Boolean(openingRecommendedPromptId) ||
                                  isReturningHome
                                }
                                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-red-100/65 disabled:cursor-wait disabled:opacity-60"
                              >
                                <span
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                                    promptVisualType === "review"
                                      ? "border-blue-100 bg-blue-50"
                                      : promptVisualType === "explore"
                                        ? "border-violet-100 bg-violet-50"
                                        : "border-emerald-100 bg-emerald-50"
                                  }`}
                                  style={{
                                    color:
                                      promptVisualType === "review"
                                        ? "#2563eb"
                                        : promptVisualType === "explore"
                                          ? "#7c3aed"
                                          : "#059669",
                                  }}
                                >
                                  {promptVisualType === "review" ? (
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      aria-hidden="true"
                                    >
                                      <path d="M4 4h16v14H7l-3 3V4Z" />
                                      <path d="m8 13 2.5-2.5L12 12l4-4" />
                                    </svg>
                                  ) : promptVisualType === "explore" ? (
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      aria-hidden="true"
                                    >
                                      <circle cx="12" cy="12" r="8" />
                                      <path d="m14.5 9.5-2 5-5 2 2-5 5-2Z" />
                                    </svg>
                                  ) : (
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      aria-hidden="true"
                                    >
                                      <path d="M4 4h11a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4Z" />
                                      <path d="m10 10 4 2.5-4 2.5V10Z" />
                                      <path d="M17 8h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2h-1" />
                                    </svg>
                                  )}
                                </span>

                                <span className="min-w-0 flex-1 text-sm leading-5 text-stone-700">
                                  {isOpening
                                    ? "Opening recommended prompt..."
                                    : recommendation.text}
                                </span>
                              
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                  </div>
                )}

              {!isRecommendedPromptsLoading &&
                recommendedPromptCards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-3 text-sm text-stone-500">
                    No recommended prompts are available right now.
                  </div>
                )}
              </section>
            </div>

            <div className="space-y-3 pb-12">
              {isModulesLoading &&
                courseModules.length === 0 &&
                !isReturningHome && (
                  <div className="flex items-center gap-2 px-1 text-sm text-stone-500">
                    <svg
                      className="animate-spin text-red-600"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" />
                    </svg>
                    Loading your course folders...
                  </div>
                )}

              {courseModules.length > 0 &&
                courseModules.map((moduleName, index) => {
                  const isOpen = openFolders.includes(index);
                  const moduleActivities = activitiesByGroup[moduleName] || [];
                  const learningOutcomeState =
                    learningOutcomesByModule[moduleName];
                  const shouldShowLearningOutcomes =
                    hoveredLearningOutcomeModule === moduleName && isOpen;

                  return (
                    <div
                      key={index}
                      className="relative overflow-hidden bg-white border border-stone-200 rounded-md shadow-sm"
                    >
                      <button
                        onClick={() => toggleFolder(index)}
                        className="w-full p-4 flex items-center justify-between hover:bg-stone-50 transition-colors"
                      >
                        <span
                          className={`font-semibold text-sm text-left ${
                            isOpen ? "text-red-700" : "text-stone-700"
                          }`}
                        >
                          {moduleName}
                        </span>

                        <svg
                          className={`text-stone-400 transition-transform duration-300 ease-out shrink-0 ml-2 ${
                            isOpen ? "rotate-180" : ""
                          }`}
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>

                      <div
                        aria-hidden={!isOpen}
                        className="grid"
                        style={{
                          gridTemplateRows: isOpen ? "1fr" : "0fr",
                          opacity: isOpen ? 1 : 0,
                          pointerEvents: isOpen ? "auto" : "none",
                          transition:
                            "grid-template-rows 300ms ease-out, opacity 220ms ease-out",
                        }}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div
                            className="relative border-t border-stone-100 bg-stone-50 p-4 space-y-4"
                            onMouseEnter={() =>
                              handleLearningOutcomesHover(moduleName)
                            }
                            onMouseLeave={() =>
                              setHoveredLearningOutcomeModule((currentModule) =>
                                currentModule === moduleName ? "" : currentModule
                              )
                            }
                          >
                          <div
                            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                              shouldShowLearningOutcomes
                                ? "opacity-100"
                                : "opacity-0"
                            }`}
                            style={{
                              gridTemplateRows: shouldShowLearningOutcomes
                                ? "1fr"
                                : "0fr",
                            }}
                          >
                            <div className="min-h-0 overflow-hidden">
                            <div
                              className="custom-scrollbar max-h-[220px] overflow-y-auto overscroll-contain rounded-xl border border-red-100 bg-white/95 p-4 pr-3 shadow-xl backdrop-blur-sm"
                              onWheel={(event) => event.stopPropagation()}
                              onTouchMove={(event) => event.stopPropagation()}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-wide text-red-600">
                                    Learning Outcomes
                                  </p>
                                  <p className="mt-1 text-xs text-stone-400">
                                    Course goals for this module.
                                  </p>
                                </div>

                                {learningOutcomeState?.isLoading && (
                                  <span className="rounded-full bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-600">
                                    Loading...
                                  </span>
                                )}
                              </div>

                              <div className="mt-3 pr-1">
                                {learningOutcomeState?.isLoading ? (
                                  <p className="text-sm text-stone-500">
                                    Opening the module and checking its outcomes...
                                  </p>
                                ) : learningOutcomeState?.error ? (
                                  <p className="text-sm text-red-600">
                                    {learningOutcomeState.error}
                                  </p>
                                ) : learningOutcomeState?.outcomes.length ? (
                                  <ul className="grid gap-2 sm:grid-cols-2">
                                    {learningOutcomeState.outcomes.map(
                                      (outcome) => (
                                        <li
                                          key={outcome}
                                          className="flex gap-2 text-sm leading-6 text-stone-700"
                                        >
                                          <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                                            <svg
                                              width="10"
                                              height="10"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="3"
                                              aria-hidden="true"
                                            >
                                              <path d="m5 12 4 4L19 6" />
                                            </svg>
                                          </span>
                                          <span>{outcome}</span>
                                        </li>
                                      )
                                    )}
                                  </ul>
                                ) : (
                                  <p className="text-sm text-stone-500">
                                    No learning outcomes found for this module yet.
                                  </p>
                                )}
                              </div>
                            </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-4">
                            <p className="text-sm text-stone-600 truncate">
                              {moduleName} Overview & Study Guidances
                            </p>

                            <button
                              onClick={() => startContextualChat(moduleName)}
                              disabled={isReturningHome}
                              className="text-xs font-semibold bg-red-600 text-white px-4 py-2 rounded-full hover:bg-red-700 transition-all shadow-sm flex items-center gap-2 shrink-0 disabled:cursor-wait disabled:opacity-60"
                            >
                              Chat with AI
                            </button>
                          </div>

                          <div className="rounded-lg border border-stone-200 bg-white p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
                                Activities
                              </p>

                              {isActivitiesLoading && (
                                <span className="text-[11px] text-stone-400">
                                  Loading...
                                </span>
                              )}
                            </div>

                            {moduleActivities.length > 0 ? (
                              <div className="space-y-2">
                                {moduleActivities.map((activity) => {
                                  const activityKey = `${activity.groupTitle}-${activity.title}-${activity.type}`;
                                  const isOpening =
                                    openingActivityKey === activityKey;
                                  const activityTypeLabel = isOpening
                                    ? "Opening..."
                                    : activity.type === "roleplay"
                                      ? "Role Play"
                                      : activity.type === "quiz"
                                        ? "Quiz"
                                        : "Activity";

                                  return (
                                    <button
                                      key={activityKey}
                                      type="button"
                                      onClick={() => openActivity(activity)}
                                      disabled={
                                        Boolean(openingActivityKey) ||
                                        isReturningHome
                                      }
                                      className="w-full flex items-center justify-between gap-3 rounded-md border border-stone-100 bg-stone-50 px-3 py-2 text-left transition-colors hover:border-red-200 hover:bg-red-50 disabled:cursor-wait disabled:opacity-70"
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-stone-700">
                                          {activity.title}
                                        </p>

                                        {activity.status && (
                                          <p className="text-xs text-stone-400">
                                            {activity.status}
                                          </p>
                                        )}
                                      </div>

                                      <div
                                        className="grid shrink-0 items-center gap-2"
                                        style={{
                                          gridTemplateColumns: "92px 76px",
                                        }}
                                      >
                                        {activity.attempts && (
                                          <span className="inline-flex w-full items-center justify-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                            {activity.attempts}
                                          </span>
                                        )}

                                        <span className="inline-flex w-full items-center justify-center rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                                          {activityTypeLabel}
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-sm text-stone-400">
                                No quizzes or role plays found for this group.
                              </p>
                            )}
                          </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {activeView === "activity" && (
          <div
            className={`flex-1 bg-white custom-scrollbar ${
              activityDetail?.type === "roleplay"
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto"
            }`}
          >
            {activityDetail?.type !== "roleplay" && (
              <div className="relative mb-4 shrink-0 px-6 pt-6">
                <button
                  type="button"
                  onClick={() => setActiveView("dashboard")}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.backgroundColor = "#fee2e2";
                    event.currentTarget.style.color = "#b91c1c";
                    event.currentTarget.style.borderColor = "#fecaca";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.backgroundColor = "transparent";
                    event.currentTarget.style.color = "#dc2626";
                    event.currentTarget.style.borderColor = "transparent";
                  }}
                  className="inline-flex items-center rounded-lg border border-transparent px-3 py-2 text-sm font-semibold transition-all duration-200"
                  style={{
                    color: "#dc2626",
                    cursor: "pointer",
                  }}
                >
                  ← Back to Dashboard
                </button>

                <h2 className="mt-2 text-center text-2xl font-extrabold text-stone-900">
                  {activityDetail?.title || "Loading activity..."}
                </h2>
              </div>
            )}

            {isActivityDetailLoading && (
              <div className="mx-6 rounded-xl border border-stone-200 bg-stone-50 p-6 text-sm text-stone-500">
                Loading activity from Noodle Factory...
              </div>
            )}

            {!isActivityDetailLoading && activityResult && (
              <div className="space-y-8 px-6 pb-6">
                <div className="flex min-h-[55vh] flex-col items-center justify-center gap-6">
                  <div className="mx-auto w-full max-w-2xl rounded-3xl border border-emerald-200 bg-emerald-50 px-10 pt-12 pb-20 text-center shadow-sm">
                    <div className="h-8" />

                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
                      ✓
                    </div>

                    <h4 className="text-2xl font-bold text-stone-900">
                      Quiz Result
                    </h4>

                    {activityResult.score && (
                      <p className="mt-6 text-3xl font-extrabold text-emerald-700">
                        {activityResult.score}
                      </p>
                    )}

                    {activityResult.summary && (
                      <p className="mt-5 text-xl font-medium text-stone-700">
                        {activityResult.summary}
                      </p>
                    )}

                    <div className="h-8" />
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleActivityReview}
                    disabled={isActivityReviewLoading}
                    className="rounded-full bg-red-600 px-8 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isActivityReviewLoading
                      ? "Loading correct answers..."
                      : showActivityReview
                        ? "Hide Correct Answers Review"
                        : resultActionLine || "View Correct Answers"}
                  </button>

                  <div className="h-3" />
                </div>

                {showActivityReview &&
                  activityReview &&
                  activityReview.questions.length > 0 && (
                    <div className="mx-auto max-w-5xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
                      <div className="mb-6 flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-2xl font-bold text-stone-900">
                            Correct Answers Review
                          </h3>

                          <p className="mt-1 text-sm text-stone-500">
                            Review your answers and the recommended answers.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        {activityReview.questions.map((reviewQuestion) => (
                          <div
                            key={`${reviewQuestion.number}-${reviewQuestion.question}`}
                            className="rounded-xl border border-stone-200 bg-stone-50 p-5"
                          >
                            <div className="mb-4">
                              <p className="text-lg font-bold text-stone-900">
                                Question {reviewQuestion.number}
                                {reviewQuestion.score && (
                                  <span className="ml-2 text-sm font-semibold text-stone-500">
                                    Score: {reviewQuestion.score}
                                  </span>
                                )}
                              </p>

                              <p className="mt-3 text-base text-stone-800">
                                {reviewQuestion.question}
                              </p>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                                <p className="text-sm font-bold uppercase tracking-wide text-emerald-700">
                                  Recommended Answer
                                </p>

                                <p className="mt-3 text-sm text-stone-800">
                                  {reviewQuestion.recommendedAnswer ||
                                    "No recommended answer detected."}
                                </p>
                              </div>

                              <div className="rounded-lg border border-stone-200 bg-white p-4">
                                <p className="text-sm font-bold uppercase tracking-wide text-stone-500">
                                  Your Answer
                                </p>

                                <p className="mt-3 text-sm text-stone-800">
                                  {reviewQuestion.yourAnswer ||
                                    "No answer detected."}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {showActivityReview &&
                  activityReview &&
                  activityReview.questions.length === 0 && (
                    <div className="mx-auto max-w-3xl rounded-xl border border-stone-200 bg-stone-50 p-6 text-center text-sm text-stone-500">
                      The correct answers review opened, but no review questions
                      were detected yet.
                    </div>
                  )}
              </div>
            )}

            {!isActivityDetailLoading &&
              !activityResult &&
              activityDetail?.type === "roleplay" && (
                <div className="relative flex min-h-0 flex-1 flex-col bg-white overflow-hidden">
                  <div className="h-16 border-b border-stone-200 flex items-center justify-between px-6 bg-stone-50 shrink-0 gap-4">
                    <div className="min-w-0">
                      <h2 className="font-bold text-stone-800 truncate">
                        Role Play: {activityDetail.title}
                      </h2>

                      <p className="text-sm text-stone-500 truncate">
                        Respond based on the role play scenario.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={
                          selectedRoleplaySessionIndex === ""
                            ? ""
                            : String(selectedRoleplaySessionIndex)
                        }
                        onChange={(event) =>
                          handleSelectRoleplaySession(event.target.value)
                        }
                        disabled={
                          isRoleplayLoading ||
                          isRoleplaySessionsLoading ||
                          roleplaySessionOptions.length === 0
                        }
                        className="h-10 w-[500px] max-w-[44vw] rounded-lg border border-stone-300 bg-white px-3 pr-3 text-sm font-medium text-stone-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {roleplaySessionOptions.length === 0 && (
                          <option value="">
                            {isRoleplaySessionsLoading
                              ? "Loading sessions..."
                              : "No sessions found"}
                          </option>
                        )}

                        {roleplaySessionOptions.map((session, displayIndex) => {
                          const displaySessionNumber = Math.max(
                            roleplaySessionOptions.length - displayIndex,
                            1,
                          );

                          return (
                            <option
                              key={session.id}
                              value={String(session.index)}
                            >
                              {`Session ${displaySessionNumber} - ${activityDetail.title}`}
                            </option>
                          );
                        })}
                      </select>

                      <button
                        type="button"
                        onClick={handleRoleplayNewSession}
                        disabled={
                          isRoleplayLoading ||
                          isRoleplaySessionsLoading ||
                          !activityDetail
                        }
                        className="text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 rounded-lg px-4 py-2 transition-colors shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + New Session
                      </button>
                    </div>
                  </div>

                  <div
                    className="min-h-0 flex-1 overflow-y-auto p-6 pr-16 custom-scrollbar"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "1rem",
                    }}
                  >
                    {roleplayMessages.length === 0 && !isRoleplayLoading && (
                      <div className="text-center text-stone-500 mt-10">
                        <h3 className="font-bold text-lg text-stone-800">
                          Role play is ready
                        </h3>

                        <p className="text-sm mt-1">
                          Start the conversation by sending your first response.
                        </p>
                      </div>
                    )}

                    {roleplayMessages.map((message, index) => {
                      const { messageText, timestamp } =
                        extractMessageTimestamp(message.content);

                      return (
                        <div
                          key={`${message.role}-${index}-${message.content}`}
                          className={`flex ${
                            message.role === "user"
                              ? "justify-end"
                              : "justify-start"
                          }`}
                        >
                          <div
                            className={`flex flex-col ${
                              message.role === "user"
                                ? "items-end"
                                : "items-start"
                            }`}
                            style={{
                              maxWidth:
                                message.role === "user"
                                  ? "420px"
                                  : "min(820px, calc(100vw - 10rem))",
                              width: "fit-content",
                            }}
                          >
                            <div
                              className={`flex ${
                                message.role === "user"
                                  ? "items-end"
                                  : "items-center gap-2"
                              }`}
                            >
                              <div
                                className={`inline-flex flex-col rounded-2xl px-5 py-3 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                                  message.role === "user"
                                    ? "bg-red-600 text-white shadow-md rounded-br-none text-justified items-end min-w-[130px]"
                                    : "bg-stone-100 text-stone-800 border border-stone-200 rounded-bl-none text-left"
                                }`}
                                style={{
                                  maxWidth:
                                    message.role === "user"
                                      ? "420px"
                                      : "min(760px, calc(100vw - 13rem))",
                                  width: "fit-content",
                                }}
                              >
                                {messageText && (
                                  <FormattedMessage content={messageText} />
                                )}

                                {message.images &&
                                  message.images.length > 0 && (
                                    <div
                                      className={`space-y-3 ${
                                        messageText ? "mt-4" : ""
                                      }`}
                                    >
                                      {message.images.map(
                                        (imageUrl, imageIndex) => (
                                          <img
                                            key={`${imageUrl}-${imageIndex}`}
                                            src={imageUrl}
                                            alt="Role play response visual"
                                            className="max-w-[420px] w-full rounded-lg border border-stone-200 bg-white shadow-sm"
                                          />
                                        ),
                                      )}
                                    </div>
                                  )}
                              </div>
                            </div>

                            {message.role === "user" && timestamp && (
                              <p className="mt-1 mr-1 text-xs text-stone-500 text-right">
                                {timestamp}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {isRoleplayLoading && (
                      <div className="flex justify-start">
                        <div className="bg-stone-100 border border-stone-200 rounded-2xl rounded-bl-none px-5 py-3 text-stone-400 text-xs animate-pulse">
                          Role play agent is responding...
                        </div>
                      </div>
                    )}

                    <div ref={roleplayMessagesEndRef} />
                  </div>

                  <div className="p-6 bg-white border-t border-stone-200 shrink-0">
                    <form
                      onSubmit={handleSendRoleplayMessage}
                      className={
                        isRoleplayComposerExpanded
                          ? "relative max-w-3xl mx-auto flex min-h-24 flex-col gap-3 overflow-hidden bg-stone-50 border border-stone-200 rounded-3xl px-5 py-4 shadow-sm focus-within:ring-2 focus-within:ring-red-500 transition-all"
                          : "relative max-w-3xl mx-auto flex min-h-16 items-center bg-stone-50 border border-stone-200 rounded-full py-2 pl-5 pr-3 shadow-sm focus-within:ring-2 focus-within:ring-red-500 transition-all"
                      }
                      style={
                        isRoleplayComposerExpanded
                          ? { borderRadius: "2rem" }
                          : undefined
                      }
                    >
                      <textarea
                        ref={roleplayInputRef}
                        rows={1}
                        value={roleplayInputValue}
                        onChange={(event) =>
                          setRoleplayInputValue(event.target.value)
                        }
                        onKeyDown={handleComposerKeyDown}
                        placeholder="Type your role play response..."
                        className={
                          isRoleplayComposerExpanded
                            ? "custom-scrollbar max-h-32 min-h-8 w-full resize-none overflow-y-auto bg-transparent text-base font-normal leading-6 text-stone-900 placeholder:text-stone-400 focus:outline-none [overflow-wrap:anywhere] [resize:none]"
                            : "custom-scrollbar max-h-32 min-h-8 flex-1 resize-none overflow-y-auto bg-transparent pr-3 text-base font-normal leading-6 text-stone-900 placeholder:text-stone-400 focus:outline-none [overflow-wrap:anywhere] [resize:none]"
                        }
                        disabled={isRoleplayLoading}
                        style={{ resize: "none" }}
                        wrap="soft"
                      />

                      <div
                        className={
                          isRoleplayComposerExpanded
                            ? "flex w-full justify-end"
                            : "ml-3 flex shrink-0"
                        }
                      >
                        <button
                          type="submit"
                          disabled={
                            !roleplayInputValue.trim() || isRoleplayLoading
                          }
                          className="bg-red-600 text-white rounded-full h-12 w-12 flex shrink-0 items-center justify-center hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                          </svg>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

            {!isActivityDetailLoading &&
              !activityResult &&
              activityDetail &&
              activityDetail.type !== "roleplay" &&
              activityDetail.questions &&
              activityDetail.questions.length > 0 && (
                <div className="space-y-8 px-6 pb-6">
                  {activityDetail.questions.map((question) => {
                    const displayedQuestionNumber =
                      activityDetail.mode === "one-at-a-time"
                        ? currentActivityQuestionNumber
                        : question.number;

                    const selectedAnswer =
                      getSelectedAnswerForQuestion(question);

                    return (
                      <div
                        key={`${displayedQuestionNumber}-${question.question}`}
                        className="rounded-xl border border-stone-200 bg-stone-50 p-5"
                      >
                        <div className="mb-4">
                          <p className="font-bold text-stone-900">
                            Question {displayedQuestionNumber}
                          </p>

                          <p className="mt-2 text-sm text-stone-800">
                            {question.question}
                          </p>
                        </div>

                        <div className="space-y-3">
                          {question.choices.map((choice, choiceIndex) => (
                            <label
                              key={`${displayedQuestionNumber}-${choiceIndex}-${choice}`}
                              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                                selectedAnswer?.choice === choice
                                  ? "border-red-300 bg-red-50 text-red-800"
                                  : "border-stone-300 bg-white text-stone-700 hover:border-red-200 hover:bg-red-50"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`question-${displayedQuestionNumber}`}
                                checked={selectedAnswer?.choice === choice}
                                onChange={() =>
                                  handleSelectActivityAnswer(
                                    question,
                                    choice,
                                    displayedQuestionNumber,
                                  )
                                }
                                className="mt-0.5 h-4 w-4 accent-red-600"
                              />

                              <span>{choice}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {activityDetail.mode === "one-at-a-time" && (
                    <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-4">
                      <button
                        type="button"
                        onClick={loadPreviousActivityQuestion}
                        disabled={
                          !activityDetail.hasPrevious ||
                          isActivityPreviousLoading ||
                          isActivityNextLoading ||
                          isActivitySubmitLoading
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-5 py-2 text-sm font-semibold text-stone-700 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        ←{" "}
                        {isActivityPreviousLoading
                          ? "Loading..."
                          : "Previous Question"}
                      </button>

                      <p className="px-4 text-center text-sm text-stone-500">
                        Question {currentActivityQuestionNumber}
                      </p>

                      {activityDetail.hasNext ? (
                        <button
                          type="button"
                          onClick={loadNextActivityQuestion}
                          disabled={
                            isActivityNextLoading ||
                            isActivityPreviousLoading ||
                            isActivitySubmitLoading
                          }
                          className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isActivityNextLoading
                            ? "Loading..."
                            : "Next Question"}{" "}
                          →
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={submitActivityQuiz}
                          disabled={
                            isActivitySubmitLoading ||
                            isActivityNextLoading ||
                            isActivityPreviousLoading
                          }
                          className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isActivitySubmitLoading
                            ? "Submitting..."
                            : "Submit Quiz"}
                        </button>
                      )}
                    </div>
                  )}

                  {activityDetail.mode !== "one-at-a-time" && (
                    <div className="flex items-center justify-end rounded-xl border border-stone-200 bg-stone-50 p-4">
                      <button
                        type="button"
                        onClick={submitActivityQuiz}
                        disabled={isActivitySubmitLoading}
                        className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isActivitySubmitLoading
                          ? "Submitting..."
                          : "Submit Quiz"}
                      </button>
                    </div>
                  )}
                </div>
              )}

            {!isActivityDetailLoading &&
              !activityResult &&
              activityDetail &&
              activityDetail.type !== "roleplay" &&
              (!activityDetail.questions ||
                activityDetail.questions.length === 0) && (
                <div className="mx-6 rounded-xl border border-stone-200 bg-stone-50 p-6 text-sm text-stone-500">
                  This activity opened, but no multiple-choice quiz questions
                  were detected yet.
                </div>
              )}
          </div>
        )}

        {activeView === "chat" && (
          <div className="relative flex-1 flex flex-col bg-white overflow-hidden">
            <div className="h-16 border-b border-stone-200 flex items-center justify-between px-6 bg-stone-50 shrink-0 gap-4">
              <h2 className="min-w-0 flex-1 pr-4 font-bold text-stone-800 truncate">
                Chatting about: {currentContext}
              </h2>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={
                    selectedSessionIndex === ""
                      ? ""
                      : String(selectedSessionIndex)
                  }
                  onChange={(e) => handleSelectSession(e.target.value)}
                  disabled={
                    isLoading ||
                    isSessionsLoading ||
                    sessionOptions.length === 0
                  }
                  className="h-10 w-[500px] max-w-[44vw] rounded-lg border border-stone-300 bg-white px-3 pr-3 text-sm font-medium text-stone-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sessionOptions.length === 0 && (
                    <option value="">
                      {isSessionsLoading
                        ? "Loading sessions..."
                        : "No sessions found"}
                    </option>
                  )}

                  {sessionOptions.map((session, displayIndex) => {
                    const displaySessionNumber =
                      session.displayNumber ??
                      Math.max(sessionOptions.length - displayIndex, 1);

                    return (
                      <option key={session.id} value={String(session.index)}>
                        {`Session ${displaySessionNumber} - ${currentContext || session.title}`}
                      </option>
                    );
                  })}
                </select>

                <button
                  type="button"
                  onClick={handleDeleteSession}
                  disabled={isDeleteSessionDisabled}
                  title={
                    isLoading || isSessionsLoading || sessionOptions.length === 0
                      ? "Wait for sessions to finish loading."
                      : !hasSelectedSessionOption
                        ? "Select a session before deleting."
                        : sessionOptions.length <= 1
                          ? "At least one session must remain."
                          : "Delete selected session"
                  }
                  className={`text-sm font-medium rounded-lg px-4 py-2 transition-colors shadow-sm ${
                    isDeleteSessionDisabled
                      ? "border border-red-200 text-red-600 bg-white cursor-not-allowed opacity-50"
                      : "border border-red-200 text-red-600 hover:text-red-700 hover:bg-red-50"
                  }`}
                >
                  Delete Session
                </button>

                <button
                  onClick={handleNewSession}
                  disabled={isLoading || !currentContext}
                  className="text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 rounded-lg px-4 py-2 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + New Session
                </button>
              </div>
            </div>

            <div
              className="flex-1 overflow-y-auto p-6 custom-scrollbar"
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              {messages.length === 0 && !isLoading && (
                <div className="text-center text-stone-500 mt-10">
                  <h3 className="font-bold text-lg text-stone-800">
                    Walter AI is online
                  </h3>

                  <p className="text-sm mt-1">
                    Ask me anything contextually indexed under "{currentContext}
                    " to get started.
                  </p>
                </div>
              )}

              {messages.map((msg, idx) => {
                const { messageText, timestamp } = extractMessageTimestamp(
                  msg.content,
                );
                const bookmarkContent = messageText || msg.content;
                const bookmarkMessage: ChatMessage = {
                  ...msg,
                  content: bookmarkContent,
                };
                const bookmarkSource = currentContext
                  ? getBookmarkSource(
                      "chat",
                      currentContext,
                      currentContext,
                      sessionOptions,
                      selectedSessionIndex,
                    )
                  : null;
                const bookmarkMessageIdentity =
                  msg.role === "assistant"
                    ? getAssistantTurnIdentity(messages, idx, "chat")
                    : "";
                const isRedirectTarget = redirectedBookmarkMessageIndex === idx;
                const isHighlightedTarget = highlightedMessageIndex === idx;
                const isBookmarked =
                  msg.role === "assistant" && bookmarkSource
                    ? isMessageBookmarked(
                        bookmarkMessage,
                        bookmarkSource,
                        bookmarkMessageIdentity,
                      ) || isRedirectTarget
                    : false;

                return (
                  <div
                    key={idx}
                    ref={(element) => {
                      messageRefs.current[idx] = element;
                    }}
                    className={`flex rounded-2xl transition-all duration-500 ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    } ${
                      isHighlightedTarget
                        ? "bg-red-50/90 px-2 py-2 ring-2 ring-red-400 ring-offset-4 ring-offset-white shadow-md"
                        : ""
                    }`}
                  >
                    <div
                      className={`flex flex-col ${
                        msg.role === "user" ? "items-end" : "items-start"
                      }`}
                      style={{
                        maxWidth:
                          msg.role === "user"
                            ? "420px"
                            : "min(820px, calc(100vw - 10rem))",
                        width: "fit-content",
                      }}
                    >
                      <div
                        className={`flex ${
                          msg.role === "user"
                            ? "items-end"
                            : "items-center gap-2"
                        }`}
                      >
                        <div
                          className={`inline-flex flex-col rounded-2xl px-5 py-3 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                            msg.role === "user"
                              ? "bg-red-600 text-white shadow-md rounded-br-none text-justified items-end min-w-[130px]"
                              : isHighlightedTarget
                                ? "bg-red-50 text-stone-800 border border-red-300 rounded-bl-none text-left shadow-md"
                                : "bg-stone-100 text-stone-800 border border-stone-200 rounded-bl-none text-left"
                          }`}
                          style={{
                            maxWidth:
                              msg.role === "user"
                                ? "420px"
                                : "min(760px, calc(100vw - 13rem))",
                            width: "fit-content",
                          }}
                        >
                          {messageText && (
                            <FormattedMessage content={messageText} />
                          )}

                          {msg.images && msg.images.length > 0 && (
                            <div
                              className={`space-y-3 ${
                                messageText ? "mt-4" : ""
                              }`}
                            >
                              {msg.images.map((imageUrl, imageIndex) => (
                                <img
                                  key={`${imageUrl}-${imageIndex}`}
                                  src={imageUrl}
                                  alt="AI response visual"
                                  className="max-w-[420px] w-full rounded-lg border border-stone-200 bg-white shadow-sm"
                                />
                              ))}
                            </div>
                          )}
                        </div>

                        {msg.role === "assistant" &&
                          currentContext &&
                          bookmarkSource && (
                            <button
                              type="button"
                              onClick={() =>
                                bookmarkSource &&
                                toggleBookmarkedMessage(
                                  bookmarkMessage,
                                  bookmarkSource,
                                  bookmarkMessageIdentity,
                                )
                              }
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border shadow-sm transition-colors ${
                                isBookmarked
                                  ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                                  : "border-stone-200 bg-white text-stone-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              }`}
                              title={
                                isBookmarked
                                  ? "Remove bookmark"
                                  : "Save bookmark"
                              }
                              aria-label={
                                isBookmarked
                                  ? "Remove bookmark"
                                  : "Save bookmark"
                              }
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill={isBookmarked ? "currentColor" : "none"}
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                              </svg>
                            </button>
                          )}
                      </div>

                      {msg.role === "user" && timestamp && (
                        <p className="mt-1 mr-1 text-xs text-stone-500 text-right">
                          {timestamp}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-stone-100 border border-stone-200 rounded-2xl rounded-bl-none px-5 py-3 text-stone-400 text-xs animate-pulse">
                    Walter AI is analyzing...
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {userMessageMarkers.length > 0 && (
              <div
                className="absolute z-30"
                style={{
                  right: "25px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: isScrollNavigatorOpen ? "320px" : "44px",
                  maxWidth: "calc(100vw - 32px)",
                }}
                onMouseEnter={() => setIsScrollNavigatorOpen(true)}
                onMouseLeave={() => setIsScrollNavigatorOpen(false)}
              >
                {isScrollNavigatorOpen ? (
                  <div
                    className="rounded-xl border border-stone-700 bg-stone-900 p-2 text-white shadow-2xl"
                    style={{
                      width: "320px",
                      maxWidth: "calc(100vw - 32px)",
                      maxHeight: "420px",
                      overflowY: "auto",
                    }}
                  >
                    <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
                      User Messages
                    </p>

                    <div className="space-y-1">
                      {userMessageMarkers.map((marker) => (
                        <button
                          key={marker.messageIndex}
                          type="button"
                          onClick={() => scrollToMessage(marker.messageIndex)}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-stone-200 hover:bg-stone-800 hover:text-white transition-colors"
                        >
                          {marker.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsScrollNavigatorOpen(true)}
                    className="flex h-[100px] min-h-[100px] w-9 flex-col items-center justify-start rounded-full border border-stone-200 bg-white px-2 py-2 shadow-lg transition-colors hover:border-red-200 hover:bg-red-50"
                    style={{ height: "100px", minHeight: "100px" }}
                    aria-label="Open user message navigator"
                    title="Browse user messages"
                  >
                  </button>
                )}
              </div>
            )}

            <div className="p-6 bg-white border-t border-stone-200 shrink-0">
              <form
                onSubmit={handleSendMessage}
                className={
                  isChatComposerExpanded
                    ? "relative max-w-3xl mx-auto flex min-h-24 flex-col gap-3 overflow-hidden bg-stone-50 border border-stone-200 rounded-3xl px-5 py-4 shadow-sm focus-within:ring-2 focus-within:ring-red-500 transition-all"
                    : "relative max-w-3xl mx-auto flex min-h-16 items-center bg-stone-50 border border-stone-200 rounded-full py-2 pl-5 pr-3 shadow-sm focus-within:ring-2 focus-within:ring-red-500 transition-all"
                }
                style={
                  isChatComposerExpanded ? { borderRadius: "2rem" } : undefined
                }
              >
                <textarea
                  ref={chatInputRef}
                  rows={1}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Ask a question..."
                  className={
                    isChatComposerExpanded
                      ? "custom-scrollbar max-h-32 min-h-8 w-full resize-none overflow-y-auto bg-transparent text-base font-normal leading-6 text-stone-900 placeholder:text-stone-400 focus:outline-none [overflow-wrap:anywhere] [resize:none]"
                      : "custom-scrollbar max-h-32 min-h-8 flex-1 resize-none overflow-y-auto bg-transparent pr-3 text-base font-normal leading-6 text-stone-900 placeholder:text-stone-400 focus:outline-none [overflow-wrap:anywhere] [resize:none]"
                  }
                  disabled={isLoading}
                  style={{ resize: "none" }}
                  wrap="soft"
                />

                <div
                  className={
                    isChatComposerExpanded
                      ? "flex w-full justify-end"
                      : "ml-3 flex shrink-0"
                  }
                >
                  <button
                    type="submit"
                    disabled={!inputValue.trim() || isLoading}
                    className="bg-red-600 text-white rounded-full h-12 w-12 flex shrink-0 items-center justify-center hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {pendingRecommendedPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{
            paddingLeft: isChatOpen ? "336px" : "80px",
            backgroundColor: "rgba(15, 23, 42, 0.42)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            animation: isRecommendedPromptClosing
              ? "recommendedPromptBackdropOut 220ms ease-in forwards"
              : "recommendedPromptBackdropIn 260ms ease-out forwards",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="recommended-prompt-dialog-title"
          onMouseDown={closeRecommendedPromptConfirmation}
        >
          <div
            className="rounded-2xl border border-red-100 bg-white p-5 text-center shadow-2xl"
            style={{
              width: "min(550px, calc(100vw - 2rem))",
              animation: isRecommendedPromptClosing
                ? "recommendedPromptDialogOut 180ms ease-in forwards"
                : "recommendedPromptDialogIn 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-600">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <path d="M12 2a7 7 0 0 0-4 12.74c.64.48 1 1.23 1 2.03V17h6v-.23c0-.8.36-1.55 1-2.03A7 7 0 0 0 12 2Z" />
              </svg>

              <span>Recommended for you</span>
            </div>

            <h3
              id="recommended-prompt-dialog-title"
              className="mt-2 text-xl font-bold text-stone-800"
            >
              Open {pendingRecommendedPrompt.moduleTitle}?
            </h3>

            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={closeRecommendedPromptConfirmation}
                className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-100"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmRecommendedPrompt}
                disabled={Boolean(openingRecommendedPromptId) || isReturningHome}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
              >
                {openingRecommendedPromptId ? "Opening..." : "Go to module"}
              </button>
            </div>
          </div>
        </div>
      )}
      <style jsx global>{`
        .recent-chats-scroll {
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: #57534e transparent;
        }

        .recent-chats-scroll::-webkit-scrollbar {
          width: 8px;
        }

        .recent-chats-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .recent-chats-scroll::-webkit-scrollbar-thumb {
          background: #57534e;
          border: 2px solid #1c1917;
          border-radius: 999px;
        }

        .recent-chats-scroll::-webkit-scrollbar-thumb:hover {
          background: #78716c;
        }

        .recent-chats-scroll::-webkit-scrollbar-button {
          display: none;
          width: 0;
          height: 0;
        }

        @keyframes recommendedPromptBackdropIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes recommendedPromptBackdropOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }

        @keyframes recommendedPromptDialogIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes recommendedPromptDialogOut {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(6px) scale(0.985);
          }
        }
      `}</style>

    </main>
  );
}
