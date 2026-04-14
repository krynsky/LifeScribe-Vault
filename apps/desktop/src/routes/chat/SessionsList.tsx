import { useChatSessions } from "../../api/queries";

interface Props {
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

export function SessionsList({ activeId, onSelect, onNewChat }: Props) {
  const { data, isLoading } = useChatSessions();
  return (
    <div style={{ padding: 8 }}>
      <button onClick={onNewChat} style={{ width: "100%", marginBottom: 8 }}>
        + New chat
      </button>
      {isLoading && <div>Loading…</div>}
      {data?.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: 8,
            background: s.id === activeId ? "#eee" : "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          <div>{s.title || "(untitled)"}</div>
          <small>{s.turn_count} turns</small>
        </button>
      ))}
    </div>
  );
}
