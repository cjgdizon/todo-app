"use client";

import { ExchangeError, parseExport, parseTasksCsv, planImport, serializeExport, tasksToCsv, type ImportPlan } from "@todo/core";
import {
  importContextFrom,
  toExchangeData,
  useApplyImport,
  useData,
  useLabels,
  useProjects,
  useSections,
  useTasks,
  type ImportProgress,
} from "@todo/data";
import { useId, useState, type ChangeEvent } from "react";
import { downloadFile, UTF8_BOM } from "@/lib/download";
import { useToast } from "./toast";

const MAX_FILE_BYTES = 5_000_000;
const SHOWN_WARNINGS = 10;

interface Preview {
  fileName: string;
  plan: ImportPlan;
  warnings: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const today = () => new Date().toISOString().slice(0, 10);

const card = "rounded-md border border-border bg-surface p-4";
const button = "rounded-md px-4 py-2 font-medium";

export function ImportExport() {
  const { timeZone } = useData();
  const tasks = useTasks();
  const projects = useProjects();
  const sections = useSections();
  const labels = useLabels();
  const apply = useApplyImport();
  const { notify } = useToast();
  const fileId = useId();

  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const ready = tasks.isSuccess && projects.isSuccess && sections.isSuccess && labels.isSuccess;
  const everything = {
    tasks: tasks.data ?? [],
    projects: projects.data ?? [],
    sections: sections.data ?? [],
    labels: labels.data ?? [],
  };

  function exportJson() {
    downloadFile(`todo-export-${today()}.json`, "application/json", serializeExport(toExchangeData(everything), new Date()));
  }

  function exportCsv() {
    downloadFile(`todo-tasks-${today()}.csv`, "text/csv", UTF8_BOM + tasksToCsv(toExchangeData(everything), timeZone));
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same file again still triggers a change
    if (!file) return;
    setError(null);
    setPreview(null);

    if (file.size > MAX_FILE_BYTES) {
      setError(`That file is ${(file.size / 1_000_000).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1_000_000} MB.`);
      return;
    }
    try {
      const text = await file.text();
      const isJson = file.name.toLowerCase().endsWith(".json") || text.trimStart().startsWith("{");
      const parsed = isJson ? parseExport(text) : parseTasksCsv(text, timeZone);
      const plan = planImport(
        parsed.data,
        importContextFrom({ ...everything, timeZone, now: new Date() }),
        () => crypto.randomUUID(),
      );
      setPreview({ fileName: file.name, plan, warnings: [...parsed.warnings, ...plan.warnings] });
    } catch (caught) {
      setError(caught instanceof ExchangeError ? caught.message : "Couldn't read that file.");
    }
  }

  async function onImport() {
    if (!preview) return;
    setProgress({ done: 0, total: 1 });
    try {
      const result = await apply(preview.plan, setProgress);
      const { counts } = result;
      const extra = [
        counts.projects > 0 ? plural(counts.projects, "project", "projects") : "",
        counts.labels > 0 ? plural(counts.labels, "label", "labels") : "",
      ].filter(Boolean);
      notify(`Imported ${plural(counts.tasks, "task", "tasks")}${extra.length ? `, ${extra.join(", ")}` : ""}.`, {
        action: { label: "Undo", run: result.undo },
      });
      setPreview(null);
    } catch {
      notify("The import failed, so nothing was kept.", { tone: "error" });
    } finally {
      setProgress(null);
    }
  }

  const importing = progress !== null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="export-heading" className={card}>
        <h2 id="export-heading" className="text-base font-medium">
          Export
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          {ready
            ? `${plural(everything.tasks.length, "task", "tasks")} in ${plural(everything.projects.length, "project", "projects")}.`
            : "Loading your tasks…"}{" "}
          The JSON backup keeps everything and can be imported again. The CSV opens in a spreadsheet.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={!ready} onClick={exportJson} className={`${button} bg-accent text-on-accent disabled:opacity-50`}>
            Download JSON backup
          </button>
          <button type="button" disabled={!ready} onClick={exportCsv} className={`${button} text-accent-strong underline disabled:opacity-50`}>
            Download CSV
          </button>
        </div>
      </section>

      <section aria-labelledby="import-heading" className={card}>
        <h2 id="import-heading" className="text-base font-medium">
          Import
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Choose a JSON backup from this app, or a CSV with a <code>title</code> column and any of: notes, priority
          (1-4), due (2026-12-24 or 2026-12-24 15:30), repeat, project, section, labels (separated by semicolons).
          You&apos;ll see what will happen before anything is added.
        </p>
        <div className="mt-3">
          <label htmlFor={fileId} className="mb-1 block text-sm font-medium">
            File to import
          </label>
          <input
            id={fileId}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            disabled={!ready || importing}
            onChange={(event) => void onFile(event)}
            className="block text-sm"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}

        {preview && (
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-sm font-medium">Ready to import {preview.fileName}</h3>
            <p className="mt-1 text-sm">
              This will add {plural(preview.plan.tasks.length, "task", "tasks")}
              {preview.plan.projects.length > 0 && `, ${plural(preview.plan.projects.length, "new project", "new projects")}`}
              {preview.plan.sections.length > 0 && `, ${plural(preview.plan.sections.length, "new section", "new sections")}`}
              {preview.plan.labels.length > 0 && `, ${plural(preview.plan.labels.length, "new label", "new labels")}`}. Projects
              and labels you already have with the same name are reused. Nothing is overwritten.
            </p>

            {preview.warnings.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-warning">
                  {plural(preview.warnings.length, "thing was", "things were")} skipped or changed
                </summary>
                <ul className="mt-1 list-disc pl-5 text-text-muted">
                  {preview.warnings.slice(0, SHOWN_WARNINGS).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                  {preview.warnings.length > SHOWN_WARNINGS && (
                    <li>…and {preview.warnings.length - SHOWN_WARNINGS} more</li>
                  )}
                </ul>
              </details>
            )}

            {importing ? (
              <div className="mt-3">
                <label className="mb-1 block text-sm" htmlFor={`${fileId}-progress`}>
                  Importing…
                </label>
                <progress id={`${fileId}-progress`} value={progress.done} max={Math.max(progress.total, 1)} className="w-full" />
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={preview.plan.tasks.length + preview.plan.projects.length + preview.plan.labels.length === 0}
                  onClick={() => void onImport()}
                  className={`${button} bg-accent text-on-accent disabled:opacity-50`}
                >
                  Import
                </button>
                <button type="button" onClick={() => setPreview(null)} className={button}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
