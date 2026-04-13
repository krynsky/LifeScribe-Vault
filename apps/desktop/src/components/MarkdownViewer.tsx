import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  body: string;
}

export default function MarkdownViewer({ body }: Props) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}
