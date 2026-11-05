/** A source file the extractor reads, with its path relative to the repository root. */
export interface SourceFile {
  path: string;
  content: string;
}

export type Confidence = "inferred" | "stated";

export interface ExtractedClaim {
  says: string;
  source: string;
  confidence: Confidence;
}

/** A node the extractor drafts. Content becomes a KB file in the extraction delta. */
export interface Candidate {
  id: string;
  kind: string;
  title: string;
  fields: Record<string, unknown>;
  claims: ExtractedClaim[];
  /** Which pass produced it. */
  pass: "inventory" | "rules" | "documents";
}

/** Progress reported while extraction runs, so a live view can grow (kb-extraction spec). */
export interface ExtractionProgress {
  pass: Candidate["pass"];
  message: string;
  drafted: string[];
}

export type ProgressListener = (progress: ExtractionProgress) => void;

/** One extraction pass. Heuristic passes run without a model; model-backed passes can replace them. */
export interface ExtractionPass {
  name: Candidate["pass"];
  run(files: readonly SourceFile[], context: { inventory: Candidate[] }): Promise<Candidate[]>;
}
