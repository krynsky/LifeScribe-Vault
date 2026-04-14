import type { ChatCitationDTO } from "../../api/client";

interface Props {
  role: "user" | "assistant";
  content: string;
  citations: ChatCitationDTO[];
}

export function MessageBubble({ role, content }: Props) {
  return <div data-role={role}>{content}</div>;
}
