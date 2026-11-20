import { modal, esc, toast } from './ui.js';
/** Build a form dialog from a field list. Fields: {id,label,type,options,value,required,hint,half,placeholder,min,max,accept}.
 *  onSubmit(values, modalEl) may throw; the message is shown in the dialog. Resolves values: files arrive as File, checkbox as boolean, multi-checkbox as array. */
export function formModal({ title, fields, submitLabel = 'Save', onSubmit, intro = '' }) {
  const fld = f => {
    const id = 'f_' + f.id, v = f.value ?? '', req = f.required ? ' *' : '';
    let inner;
    if (f.type === 'select') inner = `<select class="input" id="${id}">${(f.options || []).map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') inner = `<textarea class="input" id="${id}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
    else if (f.type === 'checkbox') return `<label style="display:flex;gap:8px;align-items:center;grid-column:1/-1"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    else if (f.type === 'multi') inner = `<div id="${id}" style="display:flex;flex-wrap:wrap;gap:8px">${(f.options || []).map(([val, lab]) => `<label class="tag" style="cursor:pointer"><input type="checkbox" value="${esc(val)}" ${(f.value || []).map(String).includes(String(val)) ? 'checked' : ''}> ${esc(lab)}</label>`).join('')}</div>`;
    else inner = `<input class="input" id="${id}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.accept ? `accept="${f.accept}"` : ''} ${f.multiple ? 'multiple' : ''} ${f.type === 'file' ? 'style="padding-top:10px"' : ''}>`;
    return `<div style="${f.half ? '' : 'grid-column:1/-1'}"><label class="f" for="${id}">${esc(f.label)}${req}</label>${inner}${f.hint ? `<small style="color:var(--muted)">${esc(f.hint)}</small>` : ''}</div>`;
  };
  const m = modal(`<h3 style="margin-bottom:6px">${esc(title)}</h3>${intro ? `<p style="color:var(--muted);font-size:13px;margin-bottom:10px">${intro}</p>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">${fields.map(fld).join('')}</div>
    <p class="ferr" style="color:var(--red);font-size:13px;min-height:18px;margin:10px 0 0"></p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px"><button class="btn ghost" data-x>Cancel</button><button class="btn y" data-ok>${esc(submitLabel)}</button></div>`);
  m.querySelector('.modal').style.maxWidth = '640px';
  m.querySelector('[data-x]').onclick = () => m.remove();
  m.querySelector('[data-ok]').onclick = async () => {
    const vals = {};
    for (const f of fields) { const el = m.querySelector('#f_' + f.id);
      vals[f.id] = f.type === 'checkbox' ? el.checked : f.type === 'file' ? (f.multiple ? [...el.files] : el.files[0] || null) : f.type === 'multi' ? [...el.querySelectorAll('input:checked')].map(i => i.value) : el.value.trim();
      if (f.required && (vals[f.id] === '' || vals[f.id] == null || (Array.isArray(vals[f.id]) && !vals[f.id].length))) { m.querySelector('.ferr').textContent = `${f.label} is required.`; return; } }
    const b = m.querySelector('[data-ok]'), old = b.textContent; b.disabled = true; b.textContent = 'Please wait…'; m.querySelector('.ferr').textContent = '';
    try { await onSubmit(vals, m); } catch (e) { m.querySelector('.ferr').textContent = e.message || String(e); b.disabled = false; b.textContent = old; }
  };
  return m;
}
