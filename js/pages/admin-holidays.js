import { mountShell } from '../shared/shell.js';
import { db, rows, col, query, orderBy } from '../core/db.js';
import { fn, activeClasses } from '../shared/api.js';
import { formModal } from '../shared/forms.js';
import { $, esc, toast, empty, skeleton } from '../shared/ui.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const { content } = await mountShell({
  role: 'admin',
  active: 'holidays.html',
  title: 'Attendance Calendar'
});

content.innerHTML = `
<section class="card">
  <div class="card-head"><h3>Centre weekly holiday</h3><button class="btn y" id="edit-centre">Change</button></div>
  <p id="centre-weekly">Loading...</p>

</section>
<section class="card">
  <div class="card-head"><h3>Class-wise weekly holidays</h3><button class="btn y" id="add-class-weekly">Add / Update</button></div>
  <div id="class-weekly">${skeleton(2)}</div>
</section>
<section class="card">
  <div class="card-head"><h3>Special date settings</h3><button class="btn y" id="add-date">Add date setting</button></div>

  <label class="f" for="calendar-month">Choose month</label>
  <input class="input" type="month" id="calendar-month" style="max-width:220px">
  <div id="date-settings" style="margin-top:14px">${skeleton(3)}</div>
</section>
<section class="card">
  <div class="card-head"><h3>Existing legacy holidays</h3></div>

  <div id="legacy-list">${skeleton(2)}</div>
</section>`;

let session = null;
let classes = [];
let legacy = [];
let settings = null;

const classOptions = () => classes.map(c => [String(c.class_no), c.label || `Class ${c.class_no}`]);
const weekdayOptions = DAYS.map((d, i) => [String(i), d]);

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return {
    from: first < session.starts_on ? session.starts_on : first,
    to: last > session.ends_on ? session.ends_on : last
  };
}

function renderWeekly() {
  const weekday = settings?.weekly?.weekday;
  $('#centre-weekly').innerHTML = weekday === undefined
    ? '<b>Sunday</b> (default schedule)'
    : `<b>${esc(DAYS[weekday])}</b> is the weekly holiday`;

  const rules = settings?.class_weekly || [];
  $('#class-weekly').innerHTML = rules.length
    ? `<div class="table-wrap"><table class="t"><thead><tr><th>Class</th><th>Weekly holiday</th><th></th></tr></thead><tbody>${rules.map(r => {
        const c = classes.find(x => Number(x.class_no) === Number(r.class_no));
        return `<tr><td>${esc(c?.label || `Class ${r.class_no}`)}</td><td>${esc(DAYS[r.weekday] || 'Unknown')}</td><td><button class="btn red sm" data-remove-weekly="${r.class_no}">Reset</button></td></tr>`;
      }).join('')}</tbody></table></div>`
    : empty('fa-calendar-week', 'No class-specific weekly rules. All classes follow the centre schedule.');

  document.querySelectorAll('[data-remove-weekly]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Reset this class to the centre weekly schedule?')) return;
      try {
        await fn('saveAttendanceWeeklyRule', {
          session_id: session.id,
          class_no: Number(b.dataset.removeWeekly),
          weekday: null
        });
        toast('Class weekly rule reset.', 'ok');
        await loadSettings();
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}

function renderDates() {
  const centre = settings?.centre_dates || [];
  const classDates = settings?.class_dates || [];
  const month = $('#calendar-month').value;
  const range = monthRange(month);

  const inMonth = x => x.date >= range.from && x.date <= range.to;
  const rows = [
    ...centre.filter(inMonth),
    ...classDates.filter(inMonth)
  ].sort((a, b) => a.date.localeCompare(b.date));

  $('#date-settings').innerHTML = rows.length
    ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Applies to</th><th>Setting</th><th>Occasion</th><th></th></tr></thead><tbody>${rows.map(r => {
        const c = classes.find(x => Number(x.class_no) === Number(r.class_no));
        return `<tr><td>${esc(r.date)}</td><td>${r.target === 'centre' ? 'Whole centre' : esc(c?.label || `Class ${r.class_no}`)}</td><td>${r.type === 'holiday' ? 'Holiday' : 'Normal Day'}</td><td>${esc(r.title || '')}</td><td><button class="btn red sm" data-remove-date="${esc(r.date)}" data-class="${r.target === 'class' ? r.class_no : ''}">Remove</button></td></tr>`;
      }).join('')}</tbody></table></div>`
    : empty('fa-calendar-days', 'No special date settings for this month.');

  document.querySelectorAll('[data-remove-date]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Remove this special date setting? The normal weekly and legacy rules will apply again.')) return;
      try {
        await fn('deleteAttendanceDateOverride', {
          session_id: session.id,
          date: b.dataset.removeDate,
          ...(b.dataset.class ? { class_no: Number(b.dataset.class) } : {})
        });
        toast('Date setting removed.', 'ok');
        await loadSettings();
      } catch (e) { toast(e.message, 'err'); }
    };
  });
}

function renderLegacy() {
  const month = $('#calendar-month').value;
  const data = legacy.filter(h => String(h.hday || '').startsWith(month));

  $('#legacy-list').innerHTML = data.length
    ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Occasion</th><th>Source</th></tr></thead><tbody>${data.map(h => `<tr><td>${esc(h.hday)}</td><td>${esc(h.title || 'Holiday')}</td><td>Legacy</td></tr>`).join('')}</tbody></table></div>`
    : empty('fa-umbrella-beach', 'No legacy holidays recorded for this month.');
}

async function loadSettings() {
  const month = $('#calendar-month').value;
  const range = monthRange(month);
  if (range.from > range.to) {
    settings = { weekly: null, class_weekly: [], centre_dates: [], class_dates: [] };
    renderWeekly();
    renderDates();
    return;
  }
  settings = await fn('getAttendanceCalendarSettings', {
    session_id: session.id,
    from: range.from,
    to: range.to
  });
  renderWeekly();
  renderDates();
}

$('#edit-centre').onclick = () => formModal({
  title: 'Centre weekly holiday',
  intro: 'Choose which weekday is a weekly holiday for the whole centre.',
  fields: [{
    id: 'weekday',
    label: 'Weekly holiday',
    type: 'select',
    options: weekdayOptions,
    value: String(settings?.weekly?.weekday ?? 0),
    required: true
  }],
  onSubmit: async (v, mm) => {
    await fn('saveAttendanceWeeklyRule', {
      session_id: session.id,
      weekday: Number(v.weekday)
    });
    mm.remove();
    toast('Centre weekly holiday saved.', 'ok');
    await loadSettings();
  }
});

$('#add-class-weekly').onclick = () => {
  if (!classes.length) return toast('No active classes found.', 'err');
  formModal({
    title: 'Class weekly holiday',
    fields: [
      { id: 'class_no', label: 'Class', type: 'select', options: classOptions(), required: true },
      { id: 'weekday', label: 'Weekly holiday', type: 'select', options: weekdayOptions, required: true }
    ],
    onSubmit: async (v, mm) => {
      await fn('saveAttendanceWeeklyRule', {
        session_id: session.id,
        class_no: Number(v.class_no),
        weekday: Number(v.weekday)
      });
      mm.remove();
      toast('Class weekly holiday saved.', 'ok');
      await loadSettings();
    }
  });
};

$('#add-date').onclick = () => {
  const fields = [
    { id: 'date', label: 'Date', type: 'date', required: true },
    { id: 'target', label: 'Applies to', type: 'select', options: [['centre', 'Whole centre'], ['class', 'Selected class']], value: 'centre', required: true },
    { id: 'class_no', label: 'Class (for class setting)', type: 'select', options: [['', 'Choose a class'], ...classOptions()] },
    { id: 'type', label: 'Day type', type: 'select', options: [['holiday', 'Holiday'], ['working', 'Normal Day']], value: 'holiday', required: true },
    { id: 'title', label: 'Occasion / note', value: 'Holiday', placeholder: 'e.g. Eid Holiday' }
  ];

  formModal({
    title: 'Add special date setting',
    intro: `Allowed dates: ${session.starts_on} to ${session.ends_on}. A Normal Day overrides even a weekly holiday.`,
    fields,
    onSubmit: async (v, mm) => {
      if (v.date < session.starts_on || v.date > session.ends_on) {
        throw new Error('Choose a date within the selected academic session.');
      }
      if (v.target === 'class' && v.class_no === '') throw new Error('Choose a class.');
      await fn('saveAttendanceDateOverride', {
        session_id: session.id,
        date: v.date,
        ...(v.target === 'class' ? { class_no: Number(v.class_no) } : {}),
        type: v.type,
        title: v.title
      });
      mm.remove();
      toast('Special date setting saved.', 'ok');
      await loadSettings();
    }
  });
};

$('#calendar-month').value = new Date().toISOString().slice(0, 7);
$('#calendar-month').onchange = async () => {
  try {
    await loadSettings();
    renderLegacy();
  } catch (e) { toast(e.message, 'err'); }
};

async function init() {
  try {
    const [sessions, active, old] = await Promise.all([
      rows(query(col('academic_sessions'), orderBy('starts_on', 'desc'))),
      activeClasses(),
      rows(query(col('centre_holidays'), orderBy('hday', 'desc')))
    ]);

    session = (sessions || []).find(s => s.is_current);
    if (!session) throw new Error('No current academic session is set.');

    classes = active || [];
    legacy = old || [];

    await loadSettings();
    renderLegacy();
  } catch (e) {
    $('#centre-weekly').textContent = e.message || 'Could not load calendar settings.';
    $('#class-weekly').innerHTML = empty('fa-triangle-exclamation', 'Calendar settings could not be loaded.');
    $('#date-settings').innerHTML = '';
    $('#legacy-list').innerHTML = '';
  }
}

init();
