const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { calculateFetchRanges } = require("../lib/webuntis/dataOrchestration");
const lessonsBackend = require("../plugins/lessons/backend");
const { loadFrontendShared, loadPlugin } = require("./helpers/fake-dom");

// Autumn break 2026: Monday 26.10. to Friday 30.10.; school starts again on Monday 02.11.
const AUTUMN_BREAK = { name: "Herbst", longName: "Herbstferien", startDate: 20261026, endDate: 20261030 };
const FRIDAY_BEFORE = 20261023;
const SATURDAY = 20261024;
const MONDAY_AFTER = 20261102;

function dateOf(ymd, hhmm = 0, DateClass = Date) {
  return new DateClass(
    Math.floor(ymd / 10000),
    (Math.floor(ymd / 100) % 100) - 1,
    ymd % 100,
    Math.floor(hhmm / 100),
    hhmm % 100,
  );
}

function ymdOf(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function lesson(date, startTime, status = "REGULAR", subject = "Mathe") {
  return { date, startTime, endTime: startTime + 45, status, subjects: [{ name: subject, longname: subject }] };
}

/** Renders the real lessons plugin with the clock frozen at `now` (YYYYMMDD + HHMM) and returns the rows as text. */
function renderRows({ now, lessons = [], holidays = [AUTUMN_BREAK], lessonsConfig = {} }) {
  const context = loadFrontendShared();
  context.MMMWebuntisFrontendShared.time.getCurrentDateContext = () => ({
    ymd: now.ymd,
    date: dateOf(now.ymd, now.hm, vm.runInContext("Date", context)),
  });
  const plugin = loadPlugin(context, "lessons");
  const config = {
    mode: "verbose",
    plugins: { lessons: { config: { nextDays: 2, dateFormat: "yyyyMMdd", hideWeekends: true, ...lessonsConfig } } },
  };
  const section = plugin.create({ translate: (_key, fallback) => fallback }).render({
    students: [{ student: { title: "Kind" }, context: { config }, data: { lessons, holidays: { ranges: holidays } } }],
  });
  return section
    .findAll("div")
    .filter((div) => /\blessonRow\b/.test(div.className))
    .map((row) => row.textContent.replaceAll(" ", " ").trim());
}

test("hideHolidays hides empty holiday days without moving the window", () => {
  const options = { now: { ymd: SATURDAY, hm: 900 }, lessons: [lesson(MONDAY_AFTER, 750, "CANCELLED", "Latein")] };

  assert.deepEqual(renderRows(options), ["20261026Herbstferien", "20261027Herbstferien", "20261028Herbstferien"]);
  // Only holiday days are left in the window, so the first of them stands for the break.
  assert.deepEqual(renderRows({ ...options, lessonsConfig: { hideHolidays: true } }), ["20261026Herbstferien"]);
});

test("on the last holiday day the school days after the break show, without a holiday row", () => {
  const rows = renderRows({
    now: { ymd: 20261030, hm: 900 },
    lessons: [lesson(MONDAY_AFTER, 750, "CANCELLED", "Latein")],
    lessonsConfig: { hideHolidays: true },
  });

  assert.equal(rows.length, 2);
  assert.match(rows[0], /^20261102.*Latein/);
  assert.equal(rows[1], "20261103no lessons");
});

test("hideHolidays keeps a holiday day that has entries", () => {
  const rows = renderRows({
    now: { ymd: 20261026, hm: 900 },
    lessons: [lesson(20261028, 900, "ADDITIONAL", "Projekttag")],
    lessonsConfig: { hideHolidays: true },
  });

  assert.equal(rows.length, 1);
  assert.match(rows[0], /^20261028.*Projekttag/);
});

test("hideHolidays hides a single public holiday, a bridge day WebUntis does not list stays", () => {
  const rows = renderRows({
    now: { ymd: 20270505, hm: 900 },
    holidays: [{ name: "Himmelfahrt", longName: "Christi Himmelfahrt", startDate: 20270506, endDate: 20270506 }],
    lessonsConfig: { hideHolidays: true },
  });

  assert.deepEqual(rows, ["20270505no lessons", "20270507no lessons"]);
});

test("without known holidays hideHolidays changes nothing", () => {
  const options = { now: { ymd: SATURDAY, hm: 900 }, holidays: [] };

  assert.deepEqual(renderRows({ ...options, lessonsConfig: { hideHolidays: true } }), renderRows(options));
});

test("with hideHolidays every listed day still lies inside the fetched range", () => {
  for (let day = 0; day < 12; day += 1) {
    const now = dateOf(FRIDAY_BEFORE);
    now.setDate(now.getDate() + day);
    const ymd = ymdOf(now);

    for (const previewNext of [false, true]) {
      const range = calculateFetchRanges({
        baseNow: dateOf(ymd, 1800),
        fetchPlan: { wantsLessonsWidget: true },
        days: { lessonsNextDays: 2 },
        options: { lessonsHideWeekends: true, lessonsPreviewNext: previewNext, holidays: [AUTUMN_BREAK] },
      }).timetable;
      const shown = renderRows({ now: { ymd, hm: 1800 }, lessonsConfig: { hideHolidays: true, previewNext } });
      for (const row of shown) {
        const shownYmd = Number(row.slice(0, 8));
        const label = `${row} (today ${ymd}, previewNext ${previewNext})`;
        assert.ok(shownYmd >= ymdOf(range.start) && shownYmd < ymdOf(range.end), label);
      }
    }
  }
});

test("hideHolidays is validated", () => {
  const { validateConfig } = lessonsBackend.setup();
  assert.deepEqual(validateConfig({ hideHolidays: true }), []);

  const messages = validateConfig({ hideHolidays: "yes" }).map((issue) => issue.message);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /hideHolidays/);
});
