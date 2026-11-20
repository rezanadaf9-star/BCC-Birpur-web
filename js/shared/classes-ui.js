import { myClassesData } from '../data/people.js';
import { esc } from './ui.js';
import { label } from '../core/classes.js';
/** Classes this person may manage: admin = all active classes, teacher = assigned classes only. */
export const myClasses = me => myClassesData(me);
export const classCards = (cls, hrefFor) => cls.length
  ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${cls.map(c => `<a class="class-card" href="${hrefFor(c)}"><b>${esc(c.label)}</b><span>${c.students} student${c.students === 1 ? '' : 's'}</span></a>`).join('')}</div>`
  : `<div class="empty"><i class="fa-solid fa-school"></i>No classes available yet. ${'Ask the admin to create or assign a class.'}</div>`;
export { label };
