import { lazy, Suspense, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/hooks/use-chat";
import { DashboardLoading } from "./deferred-content";
import type { Agent } from "@shared/schema";

const ChatPopup = lazy(() => import("@/components/chat-popup").then(m => ({ default: m.ChatPopup })));

/** The launcher and unread badge stay available without loading the chat renderer. */
export function DeferredChatPopup({ agent }: { agent: Agent }) {
  const [hasOpened, setHasOpened] = useState(false);
  const { data: messages = [] } = useMessages(agent.id);
  const launcher = (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="relative">
        <span className="absolute inset-0 w-14 h-14 rounded-full bg-primary animate-slow-ping" />
        <Button
          aria-label="Buka chat agen"
          onClick={() => setHasOpened(true)}
          size="icon"
          className="relative w-14 h-14 rounded-full shadow-lg transition-all duration-200 animate-slow-pulse"
        >
          <MessageCircle className="w-6 h-6" />
        </Button>
      </div>
      {messages.length > 0 && (
        <span className="absolute top-0 right-0 w-5 h-5 bg-destructive text-destructive-foreground text-xs font-bold rounded-full flex items-center justify-center animate-bounce">
          {Math.min(messages.length, 9)}{messages.length > 9 && "+"}
        </span>
      )}
    </div>
  );
  if (!hasOpened) return launcher;
  return (
    <Suspense fallback={<>{launcher}<DashboardLoading /></>}>
      <ChatPopup agent={agent} initiallyOpen />
    </Suspense>
  );
}
