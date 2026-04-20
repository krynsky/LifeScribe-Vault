import { useParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useChatSession } from "../api/queries";
import { api } from "../api/client";
import { SessionsList } from "./chat/SessionsList";
import { Conversation } from "./chat/Conversation";

export function ChatRoute() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useChatSession(sessionId);

  const handleDelete = async (id: string) => {
    await api.chat.deleteSession(id);
    await queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
    if (sessionId === id) {
      navigate("/chat");
    }
  };

  return (
    <div className="chat-route" style={{ display: "flex", height: "100%" }}>
      <aside style={{ width: 260, borderRight: "1px solid #ddd" }}>
        <SessionsList
          activeId={sessionId}
          onSelect={(id) => navigate(`/chat/${id}`)}
          onNewChat={() => navigate("/chat")}
          onDelete={handleDelete}
        />
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>
        <Conversation
          sessionId={sessionId}
          session={session}
          onSessionCreated={(id) => navigate(`/chat/${id}`, { replace: true })}
        />
      </main>
    </div>
  );
}
