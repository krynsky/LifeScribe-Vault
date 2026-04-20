import { useChatSessions } from "../../api/queries";

interface Props {
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
}

export function SessionsList({ activeId, onSelect, onNewChat, onDelete }: Props) {
  const { data, isLoading } = useChatSessions();
  return (
    <div style={{ padding: 8 }}>
      <button onClick={onNewChat} style={{ width: "100%", marginBottom: 8 }}>
        + New chat
      </button>
      {isLoading && <div>Loading…</div>}
      {data?.map((s) => (
        <div
          key={s.id}
          style={{
            display: "flex",
            alignItems: "center",
            background: s.id === activeId ? "#eee" : "transparent",
          }}
        >
          <button
            onClick={() => onSelect(s.id)}
            style={{
              flex: 1,
              textAlign: "left",
              padding: 8,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <div>{s.title || "(untitled)"}</div>
            <small>{s.turn_count} turns</small>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(s.id);
            }}
            title="Delete session"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 8px",
              color: "#999",
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
