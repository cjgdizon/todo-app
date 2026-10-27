"use client";

import { useCalendarIntegration, useDisconnectCalendar, useStartCalendarConnection } from "@todo/data";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "./toast";

const card = "rounded-md border border-border bg-surface p-4";
const button = "rounded-md px-4 py-2 font-medium";

const OUTCOMES: Record<string, { message: string; tone: "info" | "error" }> = {
  connected: { message: "Google Calendar is connected. Your tasks with due dates are on its way.", tone: "info" },
  denied: { message: "Google Calendar was not connected, because access was declined.", tone: "error" },
  failed: { message: "Couldn't connect Google Calendar. Try again.", tone: "error" },
};

/** Opt-in two-way sync between tasks with due dates and a "Tasks" calendar in Google Calendar. */
export function CalendarSettings() {
  const integration = useCalendarIntegration();
  const connect = useStartCalendarConnection();
  const disconnect = useDisconnectCalendar();
  const { notify } = useToast();
  const [choosing, setChoosing] = useState(false);
  const outcome = useSearchParams().get("calendar");
  const announced = useRef(false);

  // Google sends the person back here with the result in the address; say it once.
  useEffect(() => {
    const result = outcome ? OUTCOMES[outcome] : undefined;
    if (!result || announced.current) return;
    announced.current = true;
    notify(result.message, { tone: result.tone });
  }, [outcome, notify]);

  const current = integration.data;
  const connected = current?.enabled === true;

  async function onConnect() {
    try {
      window.location.assign(await connect.mutateAsync());
    } catch {
      notify("Couldn't start the connection with Google. Check your connection and try again.", { tone: "error" });
    }
  }

  function onDisconnect(removeEvents: boolean) {
    setChoosing(false);
    disconnect.mutate(removeEvents, {
      onSuccess: () => notify(removeEvents ? "Disconnected, and the Tasks calendar was removed from Google." : "Disconnected. The events stay in Google."),
      onError: () => notify("Couldn't disconnect. Check your connection and try again.", { tone: "error" }),
    });
  }

  return (
    <section aria-labelledby="calendar-heading" className={`${card} mb-6`}>
      <h2 id="calendar-heading" className="text-base font-medium">
        Google Calendar
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Optional. Tasks with a due date appear as events in a separate &ldquo;Tasks&rdquo; calendar, and changes you make to
        those events come back to the task. Finishing or deleting a task removes its event. Events you create in Google
        yourself are not turned into tasks.
      </p>

      {integration.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          <span aria-hidden="true">⚠ </span>Couldn&apos;t load the calendar connection.
        </p>
      ) : null}

      {connected ? (
        <div className="mt-3">
          <p className="text-sm">
            {current?.status === "error" ? (
              <span className="text-danger">
                <span aria-hidden="true">⚠ </span>
                {current.statusDetail ?? "Something went wrong."}
              </span>
            ) : (
              <>Connected{current?.lastSyncedAt ? `. Last synced ${current.lastSyncedAt.toLocaleString()}` : ". Syncing for the first time"}.</>
            )}
          </p>
          {choosing ? (
            <div role="group" aria-label="Disconnect Google Calendar" className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm">What should happen to the events in Google?</span>
              <button type="button" onClick={() => onDisconnect(false)} className={`${button} text-accent-strong underline`}>
                Keep them
              </button>
              <button type="button" onClick={() => onDisconnect(true)} className={`${button} text-danger underline`}>
                Remove them
              </button>
              <button type="button" onClick={() => setChoosing(false)} className={`${button} underline`}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setChoosing(true)} disabled={disconnect.isPending} className={`${button} mt-3 text-danger underline`}>
              Disconnect
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          {current?.status === "revoked" ? (
            <p className="mb-2 text-sm text-danger">
              <span aria-hidden="true">⚠ </span>
              {current.statusDetail ?? "Google access was removed."}
            </p>
          ) : null}
          <button
            type="button"
            disabled={connect.isPending || integration.isPending}
            onClick={() => void onConnect()}
            className={`${button} bg-accent text-on-accent disabled:opacity-50`}
          >
            {connect.isPending ? "Opening Google…" : current?.status === "revoked" ? "Connect again" : "Connect Google Calendar"}
          </button>
          <p className="mt-2 text-sm text-text-muted">
            Syncs the tasks of the workspace you are in now. Only the &ldquo;Tasks&rdquo; calendar this app creates is
            touched, never your other calendars.
          </p>
        </div>
      )}
    </section>
  );
}
