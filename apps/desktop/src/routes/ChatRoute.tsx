import { useParams, useNavigate } from "react-router-dom";
import { useChatSession } from "../api/queries";
import { SessionsList } from "./chat/SessionsList";
import { Conversation } from "./chat/Conversation";

export function ChatRoute() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const { data: session } = useChatSession(sessionId);
  return (
    <div className="chat-route" style={{ display: "flex", height: "100%" }}>
      <aside style={{ width: 260, borderRight: "1px solid #ddd" }}>
        <SessionsList
          activeId={sessionId}
          onSelect={(id) => navigate(`/chat/${id}`)}
          onNewChat={() => navigate("/chat")}
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
