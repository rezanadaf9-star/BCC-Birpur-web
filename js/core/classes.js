// Class numbers: Nursery=-3, LKG=-2, UKG=-1, then 1..12. Stored as integer class_no.
export const CLASS_LABELS = { '-3':'Nursery', '-2':'LKG', '-1':'UKG' };
export const label = n => CLASS_LABELS[String(n)] || `Class ${n}`;
export const ALL_CLASS_NOS = [-3,-2,-1,1,2,3,4,5,6,7,8,9,10,11,12];
const ROMAN = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
export const roman = n => n > 0 ? ROMAN[n] : label(n);
