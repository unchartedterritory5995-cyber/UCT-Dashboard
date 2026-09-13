/**
 * OptionsFlow golden-dump harness.
 *
 * Captures the OUTPUT of the options-flow curation logic that lives inside
 * `app/src/pages/OptionsFlow.jsx` (processFlowData → gradeCluster → CONV
 * clustering → autoScore → wlPopulate, plus the Top 10 Flow Picks selector)
 * so a Python port can be diffed against a byte-stable reference.
 *
 * WHY IT RENDERS THE COMPONENT
 * ----------------------------
 * None of the scoring functions are exported, and `autoScore` / `wlPopulate`
 * are closures created inside the React component body — they are not
 * reachable by import at all. `OptionsFlow.jsx` is co-owned by another
 * engineer and MUST NOT be modified (no test-only exports, no window hooks).
 * So the harness mounts the real component and drives the real UI.
 *
 * HOW THE OUTPUT IS CAPTURED (see fixtures/README.md for the full contract)
 * ------------------------------------------------------------------------
 *  - Watchlist  : the component's own "💾 Save Watchlist" button POSTs
 *                 `JSON.stringify({date, bull, bear, removed})` to
 *                 /api/watchlist/save. The stubbed fetch keeps that body
 *                 verbatim, so we get the FULL-PRECISION wlBull/wlBear state
 *                 objects — not DOM text. Zero precision loss.
 *  - Top Flow   : the "⚡ Fetch Live P/L" button POSTs the selected picks'
 *                 top contracts to /api/schwab/options-quotes, in pick order.
 *                 That gives the raw, ordered pick identity. The card's
 *                 rendered text is captured separately as a coarse alarm on
 *                 the displayed numbers (display-rounded — see README).
 *
 * MODES
 * -----
 *   CHECK (default) : assert the live output still equals fixtures/flow_golden.json
 *   WRITE           : UPDATE_FLOW_GOLDEN=1 → regenerate that file
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import OptionsFlow from "../src/pages/OptionsFlow.jsx";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const CSV_PATH = path.join(FIXTURES, "flow_sample.csv");
const TFH_PATH = path.join(FIXTURES, "top_flow_picks.json");
const GOLDEN_PATH = path.join(FIXTURES, "flow_golden.json");

const WRITE_MODE = process.env.UPDATE_FLOW_GOLDEN === "1";

/**
 * Pinned wall clock.
 *
 * parseExpiry()'s two-part "M/D" branch rolls the year forward when the parsed
 * date is already in the past, computeDTE() diffs against local midnight, and
 * wlSave stamps `date` with today's ISO day — so every one of those is a
 * function of "now". 16:00Z = 12:00 noon America/New_York, chosen so the LOCAL
 * calendar date is 2026-07-22 for every timezone offset in [-16h, +8h) — i.e.
 * the whole Americas + Europe + UTC CI runners. The guard below fails loudly
 * if the host TZ would move the local date.
 */
const PINNED_ISO = "2026-07-22T16:00:00.000Z";
const PINNED_LOCAL_DATE = "2026-07-22";

// ── fetch stub ─────────────────────────────────────────────────────────────
let CSV_TEXT;
let TOP_FLOW_PICKS;

/** Every request the component made, in order. */
let requests;
/** Bodies POSTed to /api/watchlist/save (raw strings). */
let watchlistSaves;
/** Bodies POSTed to /api/schwab/options-quotes (parsed, in order). */
let quoteBatches;

function jsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

function textResponse(body, contentType = "text/csv") {
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function notFound() {
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => "",
  };
}

function installFetchStub() {
  requests = [];
  watchlistSaves = [];
  quoteBatches = [];

  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    const method = (init.method || "GET").toUpperCase();
    requests.push({ method, url });

    // ── the flow CSV itself (any range/query shape) ──
    if (url.startsWith("/api/flow/data") || url.startsWith("/api/flow/indexes-data")) {
      return textResponse(CSV_TEXT);
    }

    // ── version probe: 404 keeps dataVersion null, which disables the
    //    today-delta merge effect AND the 600ms "deltaPending" coalesce.
    //    That removes the only timing-dependent branch in the load path. ──
    if (url.startsWith("/api/flow/version")) return notFound();

    // ── earnings calendar: 404 keeps erSoonSet null, so `er` falls back to
    //    the per-row ER flag that is actually present in the CSV fixture
    //    (deterministic, and exercises more of processFlowData than an
    //    empty Set would). ──
    if (url.startsWith("/api/calendar")) return notFound();

    // ── tracker history: drives the EXIT-penalty branch inside
    //    wlPopulate's dedup(). MUST be {active, archived}. ──
    if (url.startsWith("/api/top-flow/history")) return jsonResponse(TOP_FLOW_PICKS);

    // ── the two capture channels ──
    if (url.startsWith("/api/watchlist/save") && method === "POST") {
      watchlistSaves.push(init.body);
      return jsonResponse({ ok: true });
    }
    if (url.startsWith("/api/schwab/options-quotes") && method === "POST") {
      quoteBatches.push(JSON.parse(init.body));
      // Empty quote list => nothing is written into priceCache, so the golden
      // stays a pure function of the CSV fixture (no synthetic live prices).
      return jsonResponse({ quotes: [] });
    }

    // ── default for every other /api/* call: [] (never {}) ──
    if (url.startsWith("/api/")) return jsonResponse([]);
    return notFound();
  });
}

// ── DOM helper ─────────────────────────────────────────────────────────────
/** Walk up from `el` until an ancestor also contains `anchorText`. */
function cardContaining(el, anchorText) {
  let node = el;
  for (let i = 0; i < 12 && node; i++) {
    if (node.textContent && node.textContent.includes(anchorText)) return node;
    node = node.parentElement;
  }
  return null;
}

const normalize = (s) => (s || "").replace(/\s+/g, " ").trim();

// ── the run ────────────────────────────────────────────────────────────────
describe("OptionsFlow curation — golden dump", () => {
  beforeAll(() => {
    CSV_TEXT = fs.readFileSync(CSV_PATH, "utf8");
    TOP_FLOW_PICKS = JSON.parse(fs.readFileSync(TFH_PATH, "utf8"));

    // Fake ONLY Date. setTimeout/queueMicrotask stay real, because the
    // component interleaves real promise chains with timers and driving both
    // by hand is far more brittle than just awaiting.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PINNED_ISO));

    const d = new Date();
    const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    if (localDate !== PINNED_LOCAL_DATE) {
      throw new Error(
        `Host timezone shifts the pinned clock: local date is ${localDate}, expected ` +
          `${PINNED_LOCAL_DATE}. The golden file is only valid for hosts where ` +
          `${PINNED_ISO} lands on ${PINNED_LOCAL_DATE} locally. Run with TZ=America/New_York.`
      );
    }
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    installFetchStub();
  });

  it(
    WRITE_MODE ? "regenerates flow_golden.json (WRITE mode)" : "matches flow_golden.json (CHECK mode)",
    async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<OptionsFlow />);

      // 1. Wait for the CSV to load + processFlowData to finish. The date-range
      //    chip row only renders once availableDates is non-empty.
      const allBtn = await screen.findByRole("button", { name: "All" }, { timeout: 30_000 });

      // 2. Default dateFilter is "Last1" (newest day only). Click "All" so the
      //    golden covers the whole multi-day fixture — that is what exercises
      //    _buildDateMap / firstDate / entrySpot / latestSpot / daysSince.
      await user.click(allBtn);
      await waitFor(
        () => expect(screen.getByText("TOP 10 FLOW PICKS")).toBeInTheDocument(),
        { timeout: 30_000 }
      );

      // ── Top Flow capture ────────────────────────────────────────────────
      const heading = screen.getByText("TOP 10 FLOW PICKS");
      const card = cardContaining(heading, "Cap-weighted · sweep required");
      expect(card, "could not locate the TOP 10 FLOW PICKS card").toBeTruthy();
      const topFlowCardText = normalize(card.textContent);

      // "⚡ Fetch Live P/L" POSTs the picks' top contracts, in pick order.
      const fetchPl = screen.getByRole("button", { name: /Fetch Live P\/L/ });
      await user.click(fetchPl);
      await waitFor(() => expect(quoteBatches.length).toBeGreaterThan(0), { timeout: 30_000 });
      // Batches are 5 contracts each with an 800ms gap; wait for the button to
      // come back out of its loading state, meaning every batch has been sent.
      await waitFor(
        () => expect(screen.getByRole("button", { name: /Fetch Live P\/L/ })).toBeEnabled(),
        { timeout: 30_000 }
      );
      const topFlowContracts = quoteBatches.flat();

      // ── Watchlist capture ───────────────────────────────────────────────
      await user.click(screen.getByRole("button", { name: "Watchlist" }));
      await user.click(await screen.findByRole("button", { name: /Auto-Fill from Scanner/ }));

      // wlPopulate defers its cross-direction + dirty-dominant fallback passes
      // into a setTimeout(…, 0); give React a turn to flush those state writes
      // before we read the list back out.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Save Watchlist/ })).toBeInTheDocument();
      });
      await new Promise((r) => setTimeout(r, 50));

      await user.click(screen.getByRole("button", { name: /Save Watchlist/ }));
      await waitFor(() => expect(watchlistSaves.length).toBe(1), { timeout: 30_000 });

      const saved = JSON.parse(watchlistSaves[0]);

      // ── assemble ────────────────────────────────────────────────────────
      const golden = {
        meta: {
          producedBy: "app/tests/OptionsFlow.golden.test.jsx",
          source: "app/src/pages/OptionsFlow.jsx (unmodified)",
          pinnedClockUtc: PINNED_ISO,
          pinnedLocalDate: PINNED_LOCAL_DATE,
          fixtureCsv: "app/tests/fixtures/flow_sample.csv",
          fixtureCsvRows: CSV_TEXT.trim().split("\n").length - 1,
          fixtureTopFlowPicks: "app/tests/fixtures/top_flow_picks.json",
          dateRange: "All",
          dataMode: "stocks",
          capFilter: "All",
          top5Filter: "Both",
        },
        watchlist: {
          // Verbatim POST body of /api/watchlist/save — full float precision.
          capturedFrom: "POST /api/watchlist/save",
          date: saved.date,
          bull: saved.bull,
          bear: saved.bear,
          removed: saved.removed,
        },
        topFlow: {
          // Raw + ordered. The ONLY lossless Top-10 channel the component
          // exposes without modifying it.
          capturedFrom: "POST /api/schwab/options-quotes (Fetch Live P/L)",
          contracts: topFlowContracts,
          // Display-rounded. Coarse drift alarm for the rendered numbers.
          cardTextDisplayRounded: topFlowCardText,
        },
      };

      if (WRITE_MODE) {
        fs.writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n", "utf8");
        // Sanity: a golden with nothing in it is worthless.
        expect(golden.watchlist.bull.length + golden.watchlist.bear.length).toBeGreaterThan(0);
        expect(golden.topFlow.contracts.length).toBeGreaterThan(0);
        return;
      }

      expect(
        fs.existsSync(GOLDEN_PATH),
        `${GOLDEN_PATH} is missing — run with UPDATE_FLOW_GOLDEN=1 to create it`
      ).toBe(true);
      const expected = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));

      // Compare section-by-section so a failure names the drifting surface.
      expect(golden.meta).toEqual(expected.meta);
      expect(golden.watchlist.bull).toEqual(expected.watchlist.bull);
      expect(golden.watchlist.bear).toEqual(expected.watchlist.bear);
      expect(golden.watchlist.removed).toEqual(expected.watchlist.removed);
      expect(golden.watchlist.date).toEqual(expected.watchlist.date);
      expect(golden.topFlow.contracts).toEqual(expected.topFlow.contracts);
      expect(golden.topFlow.cardTextDisplayRounded).toEqual(
        expected.topFlow.cardTextDisplayRounded
      );
    },
    180_000
  );
});
