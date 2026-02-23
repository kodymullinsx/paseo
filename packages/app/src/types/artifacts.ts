export type ArtifactType = "code" | "diff" | "react" | "html" | "mermaid" | "svg";

export interface ArtifactItem {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  timestamp: Date;
  sourceItemId: string;
}
