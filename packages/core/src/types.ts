export type RootConfig = {
  /** Short, stable name used as the first segment of every vault path, e.g. "home". */
  name: string;
  /** Absolute path on disk (a local folder, a mounted NAS share, or a cloud-synced folder). */
  path: string;
};

/** Free-form metadata stored in a sidecar next to each file. Only a few keys are well known. */
export type Metadata = {
  doc_type?: string;
  subject?: string;
  title?: string;
  tags?: string[];
  issued_on?: string;
  expires_on?: string;
  notes?: string;
  /** Keys the owner or an agent marked as sensitive. Agents can add to this list, never remove. */
  sensitive?: string[];
  [key: string]: unknown;
};

export type FileEntry = {
  /** "<root>/<relative path>" using forward slashes. */
  vpath: string;
  root: string;
  rel: string;
  name: string;
  size: number;
  mtimeMs: number;
  sha256: string;
  meta: Metadata | null;
  hasText: boolean;
};

export type JournalEntry = {
  id: string;
  at: string;
  kind: "move" | "metadata" | "conventions" | "undo";
  actor: string;
  from?: string;
  to?: string;
  sha256?: string;
  before?: unknown;
  after?: unknown;
  undoes?: string;
  plan?: string;
};

export type SecurityPolicy = {
  /** Field-name patterns (case-insensitive regex) that are always masked for clients without reveal rights. */
  sensitivePatterns: string[];
  /** Which actions need a human approval before they take effect. */
  approvals: {
    reveal: "always" | "never";
    organize: "always" | "never";
    conventions: "always" | "never";
    metadata: "always" | "never";
  };
};

export const DEFAULT_POLICY: SecurityPolicy = {
  sensitivePatterns: [
    "number$",
    "_no$",
    "^ssn",
    "social_security",
    "account",
    "routing",
    "passport_number",
    "license_number",
    "card",
    "^pin$",
    "password",
    "secret",
    "date_of_birth",
    "^dob$",
  ],
  approvals: { reveal: "always", organize: "always", conventions: "always", metadata: "never" },
};
